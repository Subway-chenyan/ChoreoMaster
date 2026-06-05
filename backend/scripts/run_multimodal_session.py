from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agent.multimodal_choreo_graph import (
    create_test_session,
    get_test_session,
    list_test_session_checkpoints,
    resume_test_session,
    run_test_session,
)
from app.multimodal_models import (
    SketchMapping,
    TestSessionCreateRequest,
    TestSessionResumeRequest,
)


def build_mapping(session) -> SketchMapping:
    assert session.sketch_analysis is not None
    actor_ids = [
        element.id
        for element in session.sketch_analysis.elements
        if element.shape in {"ellipse", "triangle"}
    ]
    prop_ids = [
        element.id
        for element in session.sketch_analysis.elements
        if element.shape in {"rectangle", "square"}
    ]
    return SketchMapping(
        actorElementIds=actor_ids,
        propElementIds=prop_ids,
        stageOrientation="top_is_back",
        notes="长矩形和方形作为道具；椭圆和三角形作为演员；图片顶部为舞台后方。",
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--sketch", required=True)
    parser.add_argument("--start-ms", type=int, default=0)
    parser.add_argument("--end-ms", type=int, default=30000)
    args = parser.parse_args()

    request = TestSessionCreateRequest(
        audioPath=str(Path(args.audio).resolve()),
        sketchPath=str(Path(args.sketch).resolve()),
        segmentStartMs=args.start_ms,
        segmentEndMs=args.end_ms,
    )
    session_id = create_test_session(request)
    run_test_session(session_id)
    first = get_test_session(session_id)
    if first.interrupt is None or first.interrupt.get("type") != "initial_approval":
        raise RuntimeError("Expected the initial approval interrupt.")

    mapping = build_mapping(first)
    resume_test_session(
        session_id,
        TestSessionResumeRequest(
            action="edit",
            feedback="按照确认映射完善方案，并让队形变化呼应音乐强弱。",
            mapping=mapping,
        ),
    )
    second = get_test_session(session_id)
    if second.interrupt is None or second.interrupt.get("type") != "final_approval":
        raise RuntimeError("Expected the final approval interrupt.")
    if second.draft is not None:
        raise RuntimeError("Draft must not exist before final approval.")

    resume_test_session(
        session_id,
        TestSessionResumeRequest(action="approve"),
    )
    final = get_test_session(session_id)
    if final.draft is None:
        raise RuntimeError("Expected a final draft.")

    output = {
        "sessionId": session_id,
        "status": final.status,
        "audio": {
            "estimatedBpm": final.audio_analysis.estimated_bpm,
            "changeCandidates": len(
                final.audio_analysis.formation_change_candidates
            ),
        },
        "sketch": {
            "elements": len(final.sketch_analysis.elements),
            "actors": len(mapping.actor_element_ids),
            "props": len(mapping.prop_element_ids),
        },
        "proposalFormations": len(final.initial_proposal.formations),
        "summary": final.design_summary.summary,
        "draft": final.draft.validation,
        "checkpoints": len(list_test_session_checkpoints(session_id)),
        "models": final.call_log,
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
