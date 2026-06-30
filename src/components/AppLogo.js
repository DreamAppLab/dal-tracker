import React from 'react';

export default function AppLogo({ logoUrl, fallback, color, size = 48, className = '' }) {
  const roundedStyle = {
    width: size,
    height: size,
    borderRadius: size <= 28 ? 6 : 10,
    objectFit: 'cover',
    flexShrink: 0,
  };

  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt=""
        className={`app-logo-img ${className}`}
        style={roundedStyle}
      />
    );
  }

  const fontSize = size <= 28 ? 12 : size <= 40 ? 18 : 22;

  return (
    <div
      className={`project-logo app-logo-fallback ${className}`}
      style={{
        width: size,
        height: size,
        fontSize,
        background: `${color}18`,
        border: `1px solid ${color}30`,
        borderRadius: size <= 28 ? 6 : 10,
        flexShrink: 0,
      }}
    >
      {fallback}
    </div>
  );
}
