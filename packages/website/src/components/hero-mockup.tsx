import { motion } from "framer-motion";
import { useCallback, useState } from "react";

// 两张图都是本仓库构建的应用在 1440 x 826 视口下的实拍（2x），版式按这个比例留位。
const SHOT_WIDTH = 1440;
const SHOT_HEIGHT = 826;

const HERO_VIEWS = [
  {
    id: "chat",
    label: "对话",
    src: "/app-desktop-chat.webp",
    alt: "Osuna 桌面端：左侧是工作区列表，中间是与 Agent 的对话，右侧是本次改动的文件",
  },
  {
    id: "review",
    label: "审查",
    src: "/app-desktop-review.webp",
    alt: "Osuna 桌面端：在差异标签页里逐行审查 Agent 的改动",
  },
] as const;

type HeroViewId = (typeof HERO_VIEWS)[number]["id"];

const ASPECT_STYLE = { aspectRatio: `${SHOT_WIDTH} / ${SHOT_HEIGHT}` };

const PILL_TRANSITION = { duration: 0.34, ease: [0.22, 0.61, 0.36, 1] as const };

export function HeroMockup() {
  const [view, setView] = useState<HeroViewId>(HERO_VIEWS[0].id);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-center gap-1 sm:gap-2">
        {HERO_VIEWS.map((option) => (
          <ViewPill
            key={option.id}
            id={option.id}
            label={option.label}
            selected={option.id === view}
            onSelect={setView}
          />
        ))}
      </div>

      <div className="overflow-hidden rounded-xl ring-1 ring-white/10 sm:rounded-2xl">
        <div
          className="relative w-full overflow-hidden rounded-xl sm:rounded-2xl"
          style={ASPECT_STYLE}
        >
          {HERO_VIEWS.map((option) => (
            <img
              key={option.id}
              src={option.src}
              alt={option.alt}
              width={SHOT_WIDTH}
              height={SHOT_HEIGHT}
              aria-hidden={option.id === view ? undefined : true}
              className={`absolute inset-0 h-full w-full transition-opacity duration-300 ${
                option.id === view ? "opacity-100" : "opacity-0"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ViewPill({
  id,
  label,
  selected,
  onSelect,
}: {
  id: HeroViewId;
  label: string;
  selected: boolean;
  onSelect: (id: HeroViewId) => void;
}) {
  const select = useCallback(() => onSelect(id), [onSelect, id]);
  return (
    <button
      type="button"
      onClick={select}
      aria-pressed={selected}
      className={`relative cursor-pointer rounded-full px-2.5 py-1.5 text-xs transition-colors sm:px-3.5 sm:text-sm ${
        selected ? "text-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {selected ? (
        <motion.span
          layoutId="hero-mockup-pill"
          transition={PILL_TRANSITION}
          className="absolute inset-0 rounded-full bg-white/8 ring-1 ring-white/12 ring-inset"
        />
      ) : null}
      <span className="relative">{label}</span>
    </button>
  );
}
