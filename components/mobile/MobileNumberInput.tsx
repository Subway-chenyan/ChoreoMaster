import React, { useEffect, useState } from 'react';

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number;
  onValueChange: (value: number) => void;
};

// 允许暂时清空输入框或输入小数点，只有有效数值进入项目和撤销记录。
export function MobileNumberInput({ value, onValueChange, ...props }: Props) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <input
      {...props}
      type="number"
      value={draft}
      onChange={(event) => {
        const text = event.target.value;
        setDraft(text);
        const next = Number(text);
        if (
          text.trim() &&
          Number.isFinite(next) &&
          (props.min === undefined || next >= Number(props.min)) &&
          (props.max === undefined || next <= Number(props.max)) &&
          next !== value
        )
          onValueChange(next);
      }}
      onBlur={() => setDraft(String(value))}
    />
  );
}
