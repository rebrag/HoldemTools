import { useEffect, useRef, useState } from "react";

type UseTypewriterParams = {
  text: string;
  start: boolean;
  speedMs: number;
};

export function useTypewriter({ text, start, speedMs }: UseTypewriterParams): string {
  const [out, setOut] = useState<string>("");
  const doneRef = useRef<boolean>(false);

  useEffect(() => {
    if (!start) return;
    if (doneRef.current) {
      setOut(text);
      return;
    }

    let i = 0;
    setOut("");

    const id = window.setInterval(() => {
      i += 1;
      setOut(text.slice(0, i));
      if (i >= text.length) {
        doneRef.current = true;
        window.clearInterval(id);
      }
    }, speedMs);

    return () => window.clearInterval(id);
  }, [text, start, speedMs]);

  return out;
}
