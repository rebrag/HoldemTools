// src/components/CopyButton.tsx
// Small icon + label button that copies the given text to the clipboard and
// briefly shows a "Copied" confirmation. Uses the shared copyText helper, which
// falls back to execCommand for non-secure contexts.
import React, { useState } from "react";
import { copyText } from "@/lib/clipboard";

interface Props {
  text: string;
  className?: string;
  label?: string;
}

const ClipboardIcon: React.FC = () => (
  <svg
    viewBox="0 0 20 20"
    className="h-3.5 w-3.5"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    aria-hidden="true"
  >
    <rect x="6.5" y="3" width="7" height="3" rx="1" />
    <path d="M8 4.5H6A2 2 0 0 0 4 6.5v9A2 2 0 0 0 6 17.5h8a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-2" />
  </svg>
);

const CheckIcon: React.FC = () => (
  <svg
    viewBox="0 0 20 20"
    className="h-3.5 w-3.5"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4.5 10.5l3.5 3.5 7.5-8" />
  </svg>
);

const CopyButton: React.FC<Props> = ({ text, className, label = "Copy" }) => {
  const [copied, setCopied] = useState(false);

  const onCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await copyText(text);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={copied ? "Copied to clipboard" : "Copy hand history"}
      className={`inline-flex items-center gap-1 ${className ?? ""}`}
    >
      {copied ? <CheckIcon /> : <ClipboardIcon />}
      {copied ? "Copied" : label}
    </button>
  );
};

export default CopyButton;
