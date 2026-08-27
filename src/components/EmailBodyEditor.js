import React, { useRef } from 'react';

export default function EmailBodyEditor({ defaultHtml, onChange }) {
  const ref = useRef(null);
  const initialized = useRef(false);

  return (
    <div
      ref={(el) => {
        ref.current = el;
        if (el && !initialized.current) {
          el.innerHTML = defaultHtml || '';
          initialized.current = true;
        }
      }}
      className="form-textarea email-compose-body"
      contentEditable
      role="textbox"
      aria-label="Body"
      suppressContentEditableWarning
      onInput={() => {
        if (ref.current) onChange(ref.current.innerHTML);
      }}
    />
  );
}
