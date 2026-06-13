from __future__ import annotations

import json
import mimetypes
import os
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any, TypeVar

from google import genai
from google.genai import types
from dotenv import dotenv_values
from pydantic import BaseModel

from app.models import AIChoreoPlan
from app.multimodal_models import (
    AudioAnalysis,
    DesignSummary,
    InitialDesignProposal,
    MediaFileRef,
    SketchAnalysis,
    SketchMapping,
)


T = TypeVar("T", bound=BaseModel)


def _refresh_local_model_environment() -> None:
    env_path = Path(__file__).resolve().parents[3] / ".env"
    if not env_path.is_file():
        return
    for key, value in dotenv_values(env_path).items():
        if value is not None and (not os.getenv(key) or key.startswith("GEMINI_")):
            os.environ[key] = value


def validate_multimodal_configuration() -> None:
    _refresh_local_model_environment()
    provider = os.getenv("MULTIMODAL_LLM_PROVIDER", "gemini").strip().lower()
    if provider != "gemini":
        raise ValueError(
            "多模态编舞 Agent 当前仅支持 MULTIMODAL_LLM_PROVIDER=gemini。"
        )
    if not os.getenv("GEMINI_API_KEY", "").strip():
        raise ValueError(
            "未配置 GEMINI_API_KEY。请在项目根目录 .env 中填写后重试。"
        )


class GeminiMultimodalProvider:
    def __init__(self) -> None:
        validate_multimodal_configuration()
        provider = os.getenv(
            "MULTIMODAL_LLM_PROVIDER",
            "gemini",
        ).strip().lower()
        if provider != "gemini":
            raise ValueError(
                "The multimodal choreography agent currently supports "
                "MULTIMODAL_LLM_PROVIDER=gemini only."
            )
        api_key = os.getenv("GEMINI_API_KEY", "").strip()
        if not api_key:
            raise ValueError(
                "未配置 GEMINI_API_KEY。请在项目根目录 .env 中填写后重试。"
            )
        self.client = genai.Client(api_key=api_key)
        self.flash_model = os.getenv("GEMINI_FLASH_MODEL", "gemini-2.5-flash")
        self.pro_model = os.getenv("GEMINI_PRO_MODEL", "gemini-2.5-pro")

    def prepare_audio_segment(
        self,
        source_path: str,
        start_ms: int,
        end_ms: int,
        output_dir: str,
    ) -> str:
        output_path = str(Path(output_dir) / "segment.wav")
        duration_seconds = (end_ms - start_ms) / 1000
        command = [
            os.getenv("FFMPEG_PATH", "ffmpeg"),
            "-y",
            "-ss",
            f"{start_ms / 1000:.3f}",
            "-i",
            source_path,
            "-t",
            f"{duration_seconds:.3f}",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            output_path,
        ]
        result = subprocess.run(command, capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg failed: {result.stderr[-1000:]}")
        return output_path

    def upload_file(self, path: str, mime_type: str | None = None) -> MediaFileRef:
        detected = mime_type or mimetypes.guess_type(path)[0] or "application/octet-stream"
        uploaded = self.client.files.upload(
            file=path,
            config=types.UploadFileConfig(mime_type=detected),
        )
        if uploaded.name:
            deadline = time.monotonic() + 120
            while getattr(uploaded.state, "name", str(uploaded.state)) == "PROCESSING":
                if time.monotonic() >= deadline:
                    raise TimeoutError(f"Gemini file processing timed out: {uploaded.name}")
                time.sleep(1)
                uploaded = self.client.files.get(name=uploaded.name)
            if getattr(uploaded.state, "name", str(uploaded.state)) == "FAILED":
                raise RuntimeError(f"Gemini file processing failed: {uploaded.error}")
        return MediaFileRef(
            name=uploaded.name or "",
            uri=uploaded.uri or "",
            mimeType=uploaded.mime_type or detected,
            localPath=path,
        )

    def delete_file(self, file_ref: MediaFileRef) -> None:
        if file_ref.name:
            self.client.files.delete(name=file_ref.name)

    def analyze_audio(
        self,
        audio_ref: MediaFileRef,
        start_ms: int,
        end_ms: int,
    ) -> AudioAnalysis:
        prompt = f"""
分析这段舞台编舞用音乐。上传文件已裁剪为原曲 {start_ms}ms 到 {end_ms}ms。
输出节奏感、估计 BPM、动态变化、情绪、带毫秒时间戳的显著时刻，并给出至少两个适合切换关键队形的候选时刻。
所有 timestampMs 必须使用原曲绝对时间，范围严格在 {start_ms} 到 {end_ms} 之间。
"""
        return self._generate(
            self.flash_model,
            [self._file_part(audio_ref), prompt],
            AudioAnalysis,
        )

    def analyze_sketch(self, sketch_ref: MediaFileRef) -> SketchAnalysis:
        prompt = """
分析这张手绘舞台队形草图。识别主要红色图形，忽略纸张横线和中间黑色折痕。
为每个主要图形给出稳定唯一 id、形状、中心点和尺寸，坐标归一化到 0-100。
不要擅自决定图形是演员还是道具；不确定时 possibleRole 必须为 unknown。
推测舞台方向，但若图片没有明确标记则 stageOrientation 为 unknown。
列出需要用户确认的形状语义和舞台前后方向问题。
"""
        return self._generate(
            self.flash_model,
            [self._file_part(sketch_ref), prompt],
            SketchAnalysis,
        )

    def generate_initial_proposal(
        self,
        audio: AudioAnalysis | None,
        sketch: SketchAnalysis | None,
        requirements: str,
        start_ms: int,
        end_ms: int,
    ) -> InitialDesignProposal:
        audio_context = (
            audio.model_dump_json(by_alias=True)
            if audio
            else "未提供音频，不要声称已分析节奏；根据用户要求合理安排时间。"
        )
        sketch_context = (
            sketch.model_dump_json(by_alias=True)
            if sketch
            else "未提供草图，可根据用户文字要求自由设计空间结构。"
        )
        prompt = f"""
根据已提供的音乐分析、草图分析和用户要求，提出初步关键队形方案。
输入模态可能缺失，只能使用实际提供的信息，不得虚构分析来源。
尚未确认草图语义时，不得把 unknown 图形强行归类；必须把这些内容列入 questions。
每个队形 timeMs 必须在 {start_ms} 到 {end_ms} 内。
用户要求：{requirements or "用户未提供文字要求，请根据现有素材提出合理方案。"}
音乐分析：{audio_context}
草图分析：{sketch_context}
"""
        return self._generate(
            self.flash_model,
            [prompt],
            InitialDesignProposal,
        )

    def refine_design(
        self,
        proposal: InitialDesignProposal,
        mapping: SketchMapping,
        feedback: str,
        audio: AudioAnalysis | None,
        sketch: SketchAnalysis | None,
    ) -> InitialDesignProposal:
        prompt = f"""
根据用户确认的草图映射和反馈完善初步方案，保留音乐片段边界。
映射：{mapping.model_dump_json(by_alias=True)}
反馈：{feedback or "用户确认映射，请继续完善。"}
音乐：{audio.model_dump_json(by_alias=True) if audio else "未提供"}
草图：{sketch.model_dump_json(by_alias=True) if sketch else "未提供"}
原方案：{proposal.model_dump_json(by_alias=True)}
questions 应清空，除非仍存在无法生成最终结构的关键歧义。
"""
        return self._generate(self.flash_model, [prompt], InitialDesignProposal)

    def generate_design_summary(
        self,
        proposal: InitialDesignProposal,
        mapping: SketchMapping,
        audio: AudioAnalysis | None,
        sketch: SketchAnalysis | None,
    ) -> DesignSummary:
        prompt = f"""
为编舞师生成最终确认前的设计总结，清楚解释音乐依据、草图使用方式、关键队形顺序和风险。
方案：{proposal.model_dump_json(by_alias=True)}
映射：{mapping.model_dump_json(by_alias=True)}
音乐：{audio.model_dump_json(by_alias=True) if audio else "未提供；musicRationale 应说明未使用音乐输入。"}
草图：{sketch.model_dump_json(by_alias=True) if sketch else "未提供；sketchRationale 应说明未使用草图输入。"}
"""
        return self._generate(self.pro_model, [prompt], DesignSummary)

    def generate_final_plan(
        self,
        proposal: InitialDesignProposal,
        summary: DesignSummary,
        mapping: SketchMapping,
        sketch: SketchAnalysis | None,
        start_ms: int,
        end_ms: int,
    ) -> AIChoreoPlan:
        schema = AIChoreoPlan.model_json_schema(by_alias=True)
        prompt = f"""
输出最终可应用的 AIChoreoPlan JSON。
严格要求：
1. 仅输出关键队形，不输出轨迹。
2. 时间严格位于 {start_ms} 到 {end_ms}ms。
3. 若提供草图，为 actorElementIds 中每个元素创建 performer，为 propElementIds 创建 prop。
4. 若未提供草图，根据方案自行创建合理数量的演员/道具；每帧必须包含全部创建实体。
5. 有草图时参考归一化位置；无草图时自主布局。所有坐标保持 0-100。
6. 演员和道具不得混淆，道具 propGeometryType 使用 box。
7. intent 使用 generate_formation。
方案：{proposal.model_dump_json(by_alias=True)}
总结：{summary.model_dump_json(by_alias=True)}
映射：{mapping.model_dump_json(by_alias=True)}
草图：{sketch.model_dump_json(by_alias=True) if sketch else "未提供"}
JSON Schema：{json.dumps(schema, ensure_ascii=False)}
"""
        return self._generate(self.pro_model, [prompt], AIChoreoPlan)

    def _file_part(self, file_ref: MediaFileRef) -> types.Part:
        return types.Part.from_uri(
            file_uri=file_ref.uri,
            mime_type=file_ref.mime_type,
        )

    def _generate(self, model: str, contents: list[Any], schema: type[T]) -> T:
        config_kwargs: dict[str, Any] = {
            "response_mime_type": "application/json",
            "temperature": 0.1,
        }
        # AIChoreoPlan contains dynamic position maps. Gemini's structured
        # schema endpoint rejects JSON Schema additionalProperties, so the
        # final plan uses JSON mode and is validated locally by Pydantic.
        if schema is not AIChoreoPlan:
            config_kwargs["response_schema"] = schema
        response = self.client.models.generate_content(
            model=model,
            contents=contents,
            config=types.GenerateContentConfig(**config_kwargs),
        )
        if response.parsed is not None:
            if isinstance(response.parsed, schema):
                return response.parsed
            return schema.model_validate(response.parsed)
        if not response.text:
            raise ValueError(f"Gemini {model} returned an empty response.")
        return schema.model_validate_json(response.text)


def create_session_temp_dir(session_id: str) -> str:
    root = Path(os.getenv("CHOREO_TEST_ASSET_DIR", tempfile.gettempdir()))
    path = root / "cosstage-multimodal" / session_id
    path.mkdir(parents=True, exist_ok=True)
    return str(path)
