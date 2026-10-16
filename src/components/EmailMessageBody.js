import React, { useState } from 'react';
import { emailDisplayHtml, emailFullHtml } from '../lib/emailReply';

// Body of one message in a client email thread. Client replies show only what
// the client wrote this time; a "Show full email" link reveals the complete
// original (including quoted history) when anything was hidden.
export default function EmailMessageBody({ email }) {
  const [showFull, setShowFull] = useState(false);
  const fullHtml = emailFullHtml(email);
  const html = showFull && fullHtml ? fullHtml : emailDisplayHtml(email);

  return (
    <>
      <div style={{ fontSize: 13, lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: html }} />
      {fullHtml ? (
        <button
          type="button"
          className="quotes-muted"
          onClick={(e) => {
            e.stopPropagation();
            setShowFull((v) => !v);
          }}
          style={{
            marginTop: 8,
            padding: 0,
            border: 'none',
            background: 'none',
            cursor: 'pointer',
            fontSize: 12,
            textDecoration: 'underline',
            color: 'inherit',
          }}
        >
          {showFull ? 'Hide full email' : 'Show full email'}
        </button>
      ) : null}
    </>
  );
}
