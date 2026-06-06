import { JSX, useEffect, useRef } from "react";

type LoopingPreviewVideoProps = {
  src: string;
  poster?: string;
  className?: string;
};

export function LoopingPreviewVideo(props: LoopingPreviewVideoProps): JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    const tryPlay = async (): Promise<void> => {
      try {
        await el.play();
      } catch {
        // Ignore autoplay failures; we retry on intersection.
      }
    };

    void tryPlay();

    const obs = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting) {
          void tryPlay();
        } else {
          el.pause();
        }
      },
      { threshold: 0.15 },
    );

    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div className="relative h-full w-full bg-slate-950/60">
      <video
        ref={videoRef}
        className={props.className ?? "h-full w-full object-contain"}
        muted
        playsInline
        loop
        autoPlay
        preload="metadata"
        poster={props.poster}
      >
        <source src={props.src} type="video/mp4" />
      </video>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 ring-1 ring-white/10"
      />
    </div>
  );
}
