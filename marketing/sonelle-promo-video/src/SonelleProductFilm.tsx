import type { CSSProperties, ReactNode } from "react";
import { loadFont } from "@remotion/fonts";
import { Audio } from "@remotion/media";
import { TransitionSeries, springTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import {
  BookMarked,
  Bookmark,
  Check,
  Headphones,
  Library,
  MousePointer2,
  Pause,
  Play,
  Search,
  Settings,
  Volume2,
  WholeWord,
  X,
} from "lucide-react";
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

void Promise.all([
  loadFont({
    family: "DM Sans",
    url: staticFile("fonts/dm-sans-variable.woff2"),
  }),
  loadFont({
    family: "Commit Mono",
    url: staticFile("fonts/commit-mono-400.woff2"),
    weight: "400",
  }),
  loadFont({
    family: "Commit Mono",
    url: staticFile("fonts/commit-mono-600.woff2"),
    weight: "600",
  }),
]);

const uiFont = "DM Sans, sans-serif";
const readerFont = "Commit Mono, monospace";

const colors = {
  paper: "#fcf9f8",
  shell: "#f6f3f2",
  surface: "#ffffff",
  player: "#e5e2e1",
  ink: "#242625",
  muted: "#666d69",
  softMuted: "#8a8f8c",
  line: "#c9d0cc",
  lineSoft: "#dddeda",
  green: "#153f34",
  greenTwo: "#275e4f",
  greenSoft: "#dcebe4",
  highlight: "#f5edb8",
  coral: "#d97763",
};

const easeOut = Easing.bezier(0.23, 1, 0.32, 1);
const easeMove = Easing.bezier(0.77, 0, 0.175, 1);

const tween = (
  frame: number,
  startSeconds: number,
  durationSeconds: number,
  fps: number,
  easing = easeOut,
) =>
  interpolate(
    frame,
    [startSeconds * fps, (startSeconds + durationSeconds) * fps],
    [0, 1],
    {
      easing,
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

const fadeWindow = (
  frame: number,
  startSeconds: number,
  endSeconds: number,
  fps: number,
) => {
  const enter = tween(frame, startSeconds, 0.28, fps);
  const exit = tween(frame, endSeconds - 0.24, 0.24, fps, easeMove);
  return enter * (1 - exit);
};

const GlobalBackdrop = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const drift = frame / fps;

  return (
    <AbsoluteFill style={{ background: colors.paper, overflow: "hidden" }}>
      <div
        style={{
          border: "1px solid rgba(21,63,52,0.07)",
          height: 860,
          left: 80,
          position: "absolute",
          top: -520,
          transform: `translate3d(${drift * 2.2}px, ${drift * 0.4}px, 0) rotate(24deg)`,
          width: 860,
        }}
      />
      <div
        style={{
          border: "1px solid rgba(21,63,52,0.07)",
          bottom: -560,
          height: 980,
          position: "absolute",
          right: -70,
          transform: `translate3d(${-drift * 1.8}px, ${-drift * 0.35}px, 0) rotate(24deg)`,
          width: 980,
        }}
      />
      <div
        style={{
          background: "rgba(21,63,52,0.055)",
          bottom: 0,
          left: 119,
          position: "absolute",
          top: 0,
          width: 1,
        }}
      />
      <div
        style={{
          background: "rgba(21,63,52,0.055)",
          bottom: 0,
          position: "absolute",
          right: 119,
          top: 0,
          width: 1,
        }}
      />
    </AbsoluteFill>
  );
};

const Brand = ({ inverse = false }: { inverse?: boolean }) => (
  <div
    style={{
      alignItems: "center",
      color: inverse ? colors.paper : colors.green,
      display: "flex",
      fontFamily: uiFont,
      fontSize: 23,
      fontWeight: 760,
      gap: 12,
      letterSpacing: 0,
    }}
  >
    <Img
      src={staticFile("assets/sonelle-icon.png")}
      style={{ borderRadius: 7, height: 31, width: 31 }}
    />
    Sonelle
  </div>
);

const WindowControls = () => (
  <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
    {[colors.coral, "#d9ddd9", "#d9ddd9"].map((color, index) => (
      <div
        key={`${color}-${index}`}
        style={{
          background: color,
          borderRadius: "50%",
          height: 9,
          width: 9,
        }}
      />
    ))}
  </div>
);

const SceneCopy = ({
  eyebrow,
  headline,
  body,
  dark = false,
  width = 700,
  fontSize = 84,
  align = "left",
}: {
  eyebrow: string;
  headline: ReactNode;
  body?: ReactNode;
  dark?: boolean;
  width?: number;
  fontSize?: number;
  align?: "left" | "center";
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const eyebrowIn = tween(frame, 0.18, 0.42, fps);
  const headlineIn = tween(frame, 0.28, 0.58, fps);
  const bodyIn = tween(frame, 0.38, 0.5, fps);

  return (
    <div style={{ textAlign: align, width }}>
      <div style={{ overflow: "hidden" }}>
        <div
          style={{
            color: dark ? "rgba(252,249,248,0.68)" : colors.greenTwo,
            fontFamily: uiFont,
            fontSize: 16,
            fontWeight: 720,
            letterSpacing: 0,
            opacity: eyebrowIn,
            textTransform: "uppercase",
            transform: `translate3d(0, ${(1 - eyebrowIn) * 18}px, 0)`,
          }}
        >
          {eyebrow}
        </div>
      </div>
      <div style={{ marginTop: 22, overflow: "hidden" }}>
        <div
          style={{
            color: dark ? colors.paper : colors.green,
            fontFamily: uiFont,
            fontSize,
            fontWeight: 710,
            letterSpacing: 0,
            lineHeight: 0.98,
            opacity: headlineIn,
            transform: `translate3d(0, ${(1 - headlineIn) * 32}px, 0)`,
          }}
        >
          {headline}
        </div>
      </div>
      {body == null ? null : (
        <div
          style={{
            color: dark ? "rgba(252,249,248,0.72)" : colors.muted,
            fontFamily: uiFont,
            fontSize: 23,
            lineHeight: 1.45,
            marginTop: 26,
            opacity: bodyIn,
            transform: `translate3d(0, ${(1 - bodyIn) * 16}px, 0)`,
          }}
        >
          {body}
        </div>
      )}
    </div>
  );
};

const BookCover = ({ compact = false }: { compact?: boolean }) => {
  const width = compact ? 88 : 184;
  const height = compact ? 128 : 268;

  return (
    <div
      style={{
        background: "#173a36",
        border: "1px solid rgba(255,255,255,0.24)",
        borderRadius: compact ? 4 : 8,
        boxShadow: compact
          ? "0 12px 22px rgba(17,38,32,0.2)"
          : "0 34px 70px rgba(17,38,32,0.28)",
        color: colors.paper,
        height,
        overflow: "hidden",
        position: "relative",
        width,
      }}
    >
      <div
        style={{
          background: colors.coral,
          borderRadius: "50%",
          height: compact ? 30 : 62,
          position: "absolute",
          right: compact ? -5 : -9,
          top: compact ? 15 : 32,
          width: compact ? 30 : 62,
        }}
      />
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          style={{
            border: "1px solid rgba(252,249,248,0.26)",
            borderRadius: "50%",
            height: (compact ? 54 : 110) + index * (compact ? 17 : 34),
            left: compact ? -22 : -48,
            position: "absolute",
            top: (compact ? 55 : 112) - index * (compact ? 4 : 8),
            transform: "rotate(-18deg)",
            width: (compact ? 116 : 236) + index * (compact ? 12 : 24),
          }}
        />
      ))}
      <div
        style={{
          fontFamily: uiFont,
          fontSize: compact ? 9 : 17,
          fontWeight: 720,
          left: compact ? 10 : 20,
          lineHeight: 0.98,
          position: "absolute",
          top: compact ? 13 : 26,
          width: compact ? 64 : 136,
        }}
      >
        A MAP OF
        <br />
        QUIET WATER
      </div>
      <div
        style={{
          bottom: compact ? 10 : 19,
          fontFamily: uiFont,
          fontSize: compact ? 6 : 11,
          fontWeight: 650,
          left: compact ? 10 : 20,
          opacity: 0.78,
          position: "absolute",
          textTransform: "uppercase",
        }}
      >
        Elena Ward
      </div>
    </div>
  );
};

const AppWindow = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      background: colors.surface,
      border: "1px solid rgba(21,63,52,0.16)",
      borderRadius: 14,
      boxShadow: "0 48px 110px rgba(17,39,31,0.25)",
      height: 820,
      overflow: "hidden",
      width: 1600,
    }}
  >
    <div
      style={{
        alignItems: "center",
        background: colors.surface,
        borderBottom: `1px solid ${colors.line}`,
        display: "flex",
        height: 54,
        justifyContent: "space-between",
        padding: "0 22px",
      }}
    >
      <Brand />
      <div
        style={{
          color: colors.muted,
          fontFamily: uiFont,
          fontSize: 12,
          fontWeight: 680,
        }}
      >
        Your private reading desk
      </div>
      <WindowControls />
    </div>
    {children}
  </div>
);

const LibraryWindow = ({
  dragProgress,
  importedProgress,
}: {
  dragProgress: number;
  importedProgress: number;
}) => (
  <AppWindow>
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "250px 1fr",
        height: 766,
      }}
    >
      <aside
        style={{
          background: colors.shell,
          borderRight: `1px solid ${colors.line}`,
          padding: 26,
        }}
      >
        <div
          style={{
            color: colors.green,
            fontFamily: uiFont,
            fontSize: 21,
            fontWeight: 720,
          }}
        >
          Library
        </div>
        <div
          style={{
            color: colors.muted,
            fontFamily: uiFont,
            fontSize: 12,
            marginTop: 7,
          }}
        >
          4 books on this device
        </div>
        <div style={{ display: "grid", gap: 8, marginTop: 30 }}>
          {[
            [Library, "All books", true],
            [BookMarked, "Bookmarked", false],
            [Headphones, "Ready to listen", false],
          ].map(([Icon, label, active]) => {
            const ItemIcon = Icon as typeof Library;
            return (
              <div
                key={label as string}
                style={{
                  alignItems: "center",
                  background: active ? colors.greenSoft : "transparent",
                  borderRadius: 5,
                  color: active ? colors.green : colors.muted,
                  display: "flex",
                  fontFamily: uiFont,
                  fontSize: 13,
                  fontWeight: 650,
                  gap: 10,
                  padding: "10px 11px",
                }}
              >
                <ItemIcon size={15} strokeWidth={2} />
                {label as string}
              </div>
            );
          })}
        </div>
      </aside>
      <main style={{ background: colors.paper, padding: "48px 58px" }}>
        <div
          style={{
            alignItems: "end",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div
              style={{
                color: colors.green,
                fontFamily: uiFont,
                fontSize: 43,
                fontWeight: 720,
              }}
            >
              Your library
            </div>
            <div
              style={{
                color: colors.muted,
                fontFamily: uiFont,
                fontSize: 15,
                marginTop: 8,
              }}
            >
              Books you own, ready when you are.
            </div>
          </div>
          <div
            style={{
              border: `1px solid ${colors.line}`,
              borderRadius: 6,
              color: colors.green,
              fontFamily: uiFont,
              fontSize: 13,
              fontWeight: 680,
              padding: "10px 14px",
            }}
          >
            Add EPUB
          </div>
        </div>
        <div
          style={{
            alignItems: "center",
            background: `rgba(220,235,228,${0.28 + dragProgress * 0.58})`,
            border: `2px dashed rgba(39,94,79,${0.42 + dragProgress * 0.5})`,
            borderRadius: 10,
            display: "flex",
            height: 230,
            justifyContent: "center",
            marginTop: 42,
            position: "relative",
          }}
        >
          <div style={{ opacity: 1 - importedProgress, textAlign: "center" }}>
            <div
              style={{
                alignItems: "center",
                background: colors.surface,
                borderRadius: "50%",
                color: colors.green,
                display: "flex",
                height: 52,
                justifyContent: "center",
                margin: "0 auto",
                width: 52,
              }}
            >
              <Library size={22} strokeWidth={1.8} />
            </div>
            <div
              style={{
                color: colors.green,
                fontFamily: uiFont,
                fontSize: 17,
                fontWeight: 680,
                marginTop: 16,
              }}
            >
              Drop an EPUB here
            </div>
            <div
              style={{
                color: colors.muted,
                fontFamily: uiFont,
                fontSize: 13,
                marginTop: 6,
              }}
            >
              Sonelle opens it right where reading belongs.
            </div>
          </div>
          <div
            style={{
              alignItems: "center",
              display: "flex",
              gap: 16,
              opacity: importedProgress,
              position: "absolute",
              transform: `scale(${0.96 + importedProgress * 0.04})`,
            }}
          >
            <div
              style={{
                alignItems: "center",
                background: colors.green,
                borderRadius: "50%",
                color: colors.paper,
                display: "flex",
                height: 44,
                justifyContent: "center",
                width: 44,
              }}
            >
              <Check size={21} strokeWidth={2.2} />
            </div>
            <div>
              <div
                style={{
                  color: colors.green,
                  fontFamily: uiFont,
                  fontSize: 18,
                  fontWeight: 720,
                }}
              >
                A Map of Quiet Water is ready
              </div>
              <div
                style={{
                  color: colors.muted,
                  fontFamily: uiFont,
                  fontSize: 13,
                  marginTop: 4,
                }}
              >
                Opening Chapter 3
              </div>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 28, marginTop: 42 }}>
          {["The Long Road Home", "Glass Orchard", "Night Letters"].map(
            (title, index) => (
              <div
                key={title}
                style={{
                  alignItems: "center",
                  background: colors.surface,
                  border: `1px solid ${colors.lineSoft}`,
                  borderRadius: 7,
                  display: "flex",
                  gap: 15,
                  padding: 14,
                  width: 260,
                }}
              >
                <div
                  style={{
                    background: ["#6b736f", "#9d695c", "#405c6d"][index],
                    borderRadius: 3,
                    height: 64,
                    width: 44,
                  }}
                />
                <div>
                  <div
                    style={{
                      color: colors.ink,
                      fontFamily: uiFont,
                      fontSize: 12,
                      fontWeight: 680,
                    }}
                  >
                    {title}
                  </div>
                  <div
                    style={{
                      color: colors.muted,
                      fontFamily: uiFont,
                      fontSize: 10,
                      marginTop: 7,
                    }}
                  >
                    {18 + index * 12}% read
                  </div>
                </div>
              </div>
            ),
          )}
        </div>
      </main>
    </div>
  </AppWindow>
);

const sentences = [
  "By the time Mara reached the harbor, the rain had polished every window into a small mirror.",
  "She paused beneath the station clock and listened as the chapter unfolded in a measured, familiar voice.",
  "Each sentence stayed gently lit until the final word had settled, giving her eyes an easy place to return.",
  "The page no longer asked her to choose between reading closely and letting the story carry her.",
  "Beyond the glass, the evening ferries crossed the luminous water and drew pale lines toward the islands.",
  "Mara selected the sentence again, curious about the word luminous and the memory it had stirred.",
  "A definition appeared beside the text without breaking the quiet rhythm of the chapter.",
  "She saved the word, marked the passage, and continued exactly where she had left off.",
];

type ReaderStage = "narration" | "sentence" | "lookup" | "search" | "saved";

const readerStageWindows: Record<ReaderStage, [number, number]> = {
  narration: [0, 9],
  sentence: [9, 15],
  lookup: [15, 23],
  search: [23, 28],
  saved: [28, 33],
};

const stageVisibility = (stage: ReaderStage, frame: number, fps: number) => {
  const [start, end] = readerStageWindows[stage];
  const halfWindow = 0.1;
  const enter =
    start === 0
      ? 1
      : tween(frame, start - halfWindow, halfWindow * 2, fps, easeMove);
  const exit =
    end === 33
      ? 0
      : tween(frame, end - halfWindow, halfWindow * 2, fps, easeMove);

  return enter * (1 - exit);
};

const getReaderStage = (frame: number, fps: number): ReaderStage => {
  const seconds = frame / fps;
  if (seconds < 9) return "narration";
  if (seconds < 15) return "sentence";
  if (seconds < 23) return "lookup";
  if (seconds < 28) return "search";
  return "saved";
};

const sentenceStrength = (index: number, frame: number, fps: number) => {
  const narrationStart = 0.9 + index * 1.75;
  const narrationEnter =
    index > 4 ? 0 : tween(frame, narrationStart, 0.18, fps);
  const narrationExit =
    index > 4 ? 1 : tween(frame, narrationStart + 1.48, 0.18, fps, easeMove);
  const narration =
    narrationEnter *
    (1 - narrationExit) *
    stageVisibility("narration", frame, fps);
  const sentence =
    (index === 3 ? tween(frame, 10.65, 0.18, fps) : 0) *
    stageVisibility("sentence", frame, fps);
  const lookup =
    (index === 4 ? tween(frame, 15.6, 0.18, fps) : 0) *
    stageVisibility("lookup", frame, fps);
  const saved =
    (index === 6 ? tween(frame, 28.4, 0.18, fps) : 0) *
    stageVisibility("saved", frame, fps);

  return Math.min(1, narration + sentence + lookup + saved);
};

const SaveWordState = ({
  progress,
  savedLabel = "Saved",
  marginTop,
}: {
  progress: number;
  savedLabel?: string;
  marginTop: number;
}) => (
  <div
    style={{
      background: colors.green,
      borderRadius: 5,
      height: 38,
      marginTop,
      overflow: "hidden",
      position: "relative",
    }}
  >
    <div
      style={{
        background: colors.greenSoft,
        inset: 0,
        opacity: progress,
        position: "absolute",
      }}
    />
    <div
      style={{
        alignItems: "center",
        color: colors.paper,
        display: "flex",
        fontFamily: uiFont,
        fontSize: 12,
        fontWeight: 680,
        gap: 7,
        inset: 0,
        justifyContent: "center",
        opacity: 1 - progress,
        position: "absolute",
      }}
    >
      <Bookmark size={13} /> Save word
    </div>
    <div
      style={{
        alignItems: "center",
        color: colors.green,
        display: "flex",
        fontFamily: uiFont,
        fontSize: 12,
        fontWeight: 680,
        gap: 7,
        inset: 0,
        justifyContent: "center",
        opacity: progress,
        position: "absolute",
      }}
    >
      <Check size={13} /> {savedLabel}
    </div>
  </div>
);

const ReaderParagraphs = ({ frame }: { frame: number }) => {
  const { fps } = useVideoConfig();
  const lookupOpen = tween(frame, 16.55, 0.2, fps);
  const lookupSaved = tween(frame, 20.2, 0.16, fps);
  const lookupVisibility = stageVisibility("lookup", frame, fps);
  const searchVisibility = stageVisibility("search", frame, fps);
  const savedVisibility = stageVisibility("saved", frame, fps);
  const wordReveal = lookupOpen * lookupVisibility;

  return (
    <div
      style={{
        color: colors.ink,
        fontFamily: readerFont,
        fontSize: 16,
        lineHeight: 1.86,
      }}
    >
      {[sentences.slice(0, 4), sentences.slice(4)].map(
        (paragraph, paragraphIndex) => (
          <p
            key={paragraphIndex}
            style={{
              margin: paragraphIndex === 0 ? "0 0 27px" : 0,
              textAlign: "justify",
              textAlignLast: "left",
            }}
          >
            {paragraph.map((sentence, localIndex) => {
              const index = paragraphIndex * 4 + localIndex;
              const strength = sentenceStrength(index, frame, fps);
              const searchHit = index === 0 || index === 4;
              const backgroundAlpha = searchHit
                ? Math.max(strength, searchVisibility * 0.92)
                : strength;
              const backgroundRed = 245 + (220 - 245) * searchVisibility;
              const backgroundGreen = 237 + (235 - 237) * searchVisibility;
              const backgroundBlue = 184 + (228 - 184) * searchVisibility;
              const sentenceStyle: CSSProperties = {
                background: `rgba(${backgroundRed},${backgroundGreen},${backgroundBlue},${backgroundAlpha})`,
                borderRadius: 3,
                boxDecorationBreak: "clone",
                boxShadow:
                  index === 6
                    ? `0 2px 0 rgba(21,63,52,${savedVisibility * 0.35})`
                    : "none",
                padding: "1px 2px",
                WebkitBoxDecorationBreak: "clone",
              };

              return (
                <span key={sentence}>
                  <span style={sentenceStyle}>
                    {index === 4 ? (
                      <>
                        Beyond the glass, the evening ferries crossed the{" "}
                        <span
                          style={{
                            background: `rgba(21,63,52,${0.13 * wordReveal})`,
                            borderRadius: 3,
                            color: `rgb(${36 + (21 - 36) * wordReveal},${38 + (63 - 38) * wordReveal},${37 + (52 - 37) * wordReveal})`,
                            fontWeight: 600,
                            padding: "0 1px",
                          }}
                        >
                          luminous
                        </span>{" "}
                        water and drew pale lines toward the islands.
                      </>
                    ) : (
                      sentence
                    )}
                  </span>{" "}
                </span>
              );
            })}
          </p>
        ),
      )}
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.line}`,
          borderRadius: 9,
          boxShadow: "0 24px 54px rgba(24,42,36,0.2)",
          left: 478,
          opacity: wordReveal,
          padding: 18,
          position: "absolute",
          top: 372,
          transform: `scale(${0.96 + wordReveal * 0.04})`,
          transformOrigin: "top center",
          width: 330,
          zIndex: 20,
        }}
      >
        <div
          style={{
            alignItems: "start",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div
              style={{
                color: colors.green,
                fontFamily: uiFont,
                fontSize: 27,
                fontWeight: 720,
              }}
            >
              luminous
            </div>
            <div
              style={{
                color: colors.muted,
                fontFamily: uiFont,
                fontSize: 11,
                marginTop: 3,
              }}
            >
              adjective · /ˈluːmɪnəs/
            </div>
          </div>
          <X color={colors.softMuted} size={15} strokeWidth={1.8} />
        </div>
        <div
          style={{
            color: colors.ink,
            fontFamily: uiFont,
            fontSize: 13,
            lineHeight: 1.45,
            marginTop: 13,
          }}
        >
          Giving off light; bright or shining, especially in the dark.
        </div>
        <SaveWordState progress={lookupSaved} marginTop={14} />
      </div>
    </div>
  );
};

const InspectorTabs = ({ frame }: { frame: number }) => {
  const { fps } = useVideoConfig();
  const tabs = [
    [WholeWord, "Word"],
    [Search, "Search"],
    [Bookmark, "Notes"],
    [Settings, "Tools"],
  ] as const;
  const tabStrengths = [
    stageVisibility("lookup", frame, fps),
    stageVisibility("search", frame, fps),
    Math.min(
      1,
      stageVisibility("sentence", frame, fps) +
        stageVisibility("saved", frame, fps),
    ),
    stageVisibility("narration", frame, fps),
  ];
  const totalStrength = Math.max(
    0.001,
    tabStrengths.reduce((total, strength) => total + strength, 0),
  );
  const activeIndex =
    tabStrengths.reduce(
      (total, strength, index) => total + strength * index,
      0,
    ) / totalStrength;

  return (
    <div
      style={{
        borderBottom: `1px solid ${colors.line}`,
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        position: "relative",
      }}
    >
      {tabs.map(([Icon, label], index) => {
        return (
          <div
            key={label}
            style={{
              alignItems: "center",
              color: colors.green,
              display: "flex",
              flexDirection: "column",
              fontFamily: uiFont,
              fontSize: 9,
              fontWeight: 660,
              gap: 5,
              opacity: 0.5 + tabStrengths[index] * 0.5,
              padding: "11px 4px 11px",
            }}
          >
            <Icon size={15} strokeWidth={1.8} />
            {label}
          </div>
        );
      })}
      <div
        style={{
          background: colors.green,
          bottom: -1,
          height: 2,
          left: 0,
          position: "absolute",
          transform: `translate3d(${activeIndex * 100}%, 0, 0)`,
          width: "25%",
        }}
      />
    </div>
  );
};

const InspectorPanel = ({ frame }: { frame: number }) => {
  const { fps } = useVideoConfig();
  const lookupIn = tween(frame, 16.55, 0.2, fps);
  const lookupSaved = tween(frame, 20.2, 0.16, fps);
  const queryProgress = tween(frame, 23.45, 0.75, fps, Easing.linear);
  const query = "harbor".slice(0, Math.floor(queryProgress * 6));
  const selectionMade = tween(frame, 10.65, 0.18, fps);
  const layerStyle = (panelStage: ReaderStage): CSSProperties => {
    const visibility = stageVisibility(panelStage, frame, fps);
    const [start, end] = readerStageWindows[panelStage];
    const direction = frame / fps > (start + end) / 2 ? -1 : 1;
    return {
      filter: `blur(${(1 - visibility) * 1.2}px)`,
      left: 22,
      opacity: visibility,
      position: "absolute",
      right: 22,
      top: 22,
      transform: `translate3d(0, ${(1 - visibility) * direction * 7}px, 0)`,
    };
  };

  return (
    <aside
      style={{
        background: colors.shell,
        borderLeft: `1px solid ${colors.line}`,
        minWidth: 0,
      }}
    >
      <InspectorTabs frame={frame} />
      <div style={{ height: 620, position: "relative" }}>
        <div style={layerStyle("narration")}>
          <div>
            <div
              style={{
                color: colors.green,
                fontFamily: uiFont,
                fontSize: 17,
                fontWeight: 720,
              }}
            >
              Narration
            </div>
            <div
              style={{
                color: colors.muted,
                fontFamily: uiFont,
                fontSize: 12,
                lineHeight: 1.5,
                marginTop: 8,
              }}
            >
              A calm voice follows the sentence you are reading.
            </div>
            <div
              style={{
                borderTop: `1px solid ${colors.line}`,
                marginTop: 23,
                paddingTop: 19,
              }}
            >
              <div
                style={{
                  color: colors.muted,
                  fontFamily: uiFont,
                  fontSize: 10,
                  fontWeight: 680,
                  textTransform: "uppercase",
                }}
              >
                Voice
              </div>
              <div
                style={{
                  color: colors.ink,
                  fontFamily: uiFont,
                  fontSize: 13,
                  marginTop: 8,
                }}
              >
                Amy · Warm
              </div>
              <div
                style={{
                  color: colors.muted,
                  fontFamily: uiFont,
                  fontSize: 11,
                  marginTop: 18,
                }}
              >
                Speed&nbsp;&nbsp; 1.0×
              </div>
            </div>
          </div>
        </div>
        <div style={layerStyle("sentence")}>
          <div style={{ minHeight: 210, position: "relative" }}>
            <div
              style={{
                opacity: 1 - selectionMade,
                transform: `translate3d(0, ${selectionMade * -7}px, 0)`,
              }}
            >
              <div
                style={{
                  alignItems: "center",
                  background: colors.greenSoft,
                  borderRadius: "50%",
                  color: colors.green,
                  display: "flex",
                  height: 38,
                  justifyContent: "center",
                  width: 38,
                }}
              >
                <MousePointer2 size={17} strokeWidth={1.8} />
              </div>
              <div
                style={{
                  color: colors.green,
                  fontFamily: uiFont,
                  fontSize: 17,
                  fontWeight: 720,
                  marginTop: 15,
                }}
              >
                Choose a sentence
              </div>
              <div
                style={{
                  color: colors.muted,
                  fontFamily: uiFont,
                  fontSize: 12,
                  lineHeight: 1.5,
                  marginTop: 8,
                }}
              >
                Click anywhere in the text to move playback there.
              </div>
            </div>
            <div
              style={{
                left: 0,
                opacity: selectionMade,
                position: "absolute",
                right: 0,
                top: 0,
                transform: `translate3d(0, ${(1 - selectionMade) * 7}px, 0)`,
              }}
            >
              <div
                style={{
                  color: colors.green,
                  fontFamily: uiFont,
                  fontSize: 17,
                  fontWeight: 720,
                }}
              >
                Current sentence
              </div>
              <div
                style={{
                  color: colors.ink,
                  fontFamily: uiFont,
                  fontSize: 12,
                  lineHeight: 1.55,
                  marginTop: 14,
                }}
              >
                “The page no longer asked her to choose between reading closely
                and letting the story carry her.”
              </div>
              <div
                style={{
                  alignItems: "center",
                  border: `1px solid ${colors.line}`,
                  borderRadius: 5,
                  color: colors.green,
                  display: "flex",
                  fontFamily: uiFont,
                  fontSize: 12,
                  fontWeight: 680,
                  gap: 7,
                  justifyContent: "center",
                  marginTop: 20,
                  padding: "10px 12px",
                }}
              >
                <Bookmark size={14} /> Save passage
              </div>
            </div>
          </div>
        </div>
        <div style={layerStyle("lookup")}>
          <div style={{ minHeight: 260, position: "relative" }}>
            <div
              style={{
                opacity: 1 - lookupIn,
                transform: `translate3d(0, ${lookupIn * -7}px, 0)`,
              }}
            >
              <div
                style={{
                  alignItems: "center",
                  background: colors.greenSoft,
                  borderRadius: "50%",
                  color: colors.green,
                  display: "flex",
                  height: 38,
                  justifyContent: "center",
                  width: 38,
                }}
              >
                <WholeWord size={17} strokeWidth={1.8} />
              </div>
              <div
                style={{
                  color: colors.green,
                  fontFamily: uiFont,
                  fontSize: 17,
                  fontWeight: 720,
                  marginTop: 15,
                }}
              >
                No word selected
              </div>
              <div
                style={{
                  color: colors.muted,
                  fontFamily: uiFont,
                  fontSize: 12,
                  lineHeight: 1.5,
                  marginTop: 8,
                }}
              >
                Right-click any word to see its definition.
              </div>
            </div>
            <div
              style={{
                left: 0,
                opacity: lookupIn,
                position: "absolute",
                right: 0,
                top: 0,
                transform: `translate3d(0, ${(1 - lookupIn) * 7}px, 0)`,
              }}
            >
              <div
                style={{
                  color: colors.green,
                  fontFamily: uiFont,
                  fontSize: 27,
                  fontWeight: 720,
                }}
              >
                luminous
              </div>
              <div
                style={{
                  color: colors.muted,
                  fontFamily: uiFont,
                  fontSize: 11,
                  marginTop: 4,
                }}
              >
                adjective · /ˈluːmɪnəs/
              </div>
              <dl
                style={{
                  color: colors.ink,
                  fontFamily: uiFont,
                  fontSize: 12,
                  lineHeight: 1.5,
                  margin: "20px 0 0",
                }}
              >
                <dt style={{ color: colors.muted, fontSize: 10 }}>
                  DEFINITION
                </dt>
                <dd style={{ margin: "5px 0 16px" }}>
                  Giving off light; bright or shining.
                </dd>
                <dt style={{ color: colors.muted, fontSize: 10 }}>SYNONYMS</dt>
                <dd style={{ margin: "5px 0 0" }}>radiant, glowing, vivid</dd>
              </dl>
              <SaveWordState
                progress={lookupSaved}
                savedLabel="Saved to words"
                marginTop={22}
              />
            </div>
          </div>
        </div>
        <div style={layerStyle("search")}>
          <div>
            <div
              style={{
                alignItems: "center",
                background: colors.surface,
                border: `1px solid ${colors.line}`,
                borderRadius: 5,
                color: colors.muted,
                display: "flex",
                gap: 8,
                padding: "10px 11px",
              }}
            >
              <Search size={14} />
              <span
                style={{
                  color: query.length > 0 ? colors.ink : colors.softMuted,
                  fontFamily: uiFont,
                  fontSize: 12,
                }}
              >
                {query.length > 0 ? query : "Search chapter"}
              </span>
            </div>
            <div style={{ display: "grid", gap: 9, marginTop: 17 }}>
              {[sentences[0], sentences[4]].map((sentence, index) => {
                const itemIn = tween(frame, 24.1 + index * 0.06, 0.24, fps);
                return (
                  <div
                    key={sentence}
                    style={{
                      background: colors.surface,
                      border: `1px solid ${colors.lineSoft}`,
                      borderRadius: 5,
                      opacity: itemIn,
                      padding: 12,
                      transform: `translate3d(0, ${(1 - itemIn) * 8}px, 0)`,
                    }}
                  >
                    <div
                      style={{
                        color: colors.green,
                        fontFamily: uiFont,
                        fontSize: 10,
                        fontWeight: 680,
                      }}
                    >
                      Sentence {index === 0 ? 1 : 5}
                    </div>
                    <div
                      style={{
                        color: colors.muted,
                        fontFamily: uiFont,
                        fontSize: 10,
                        lineHeight: 1.45,
                        marginTop: 6,
                      }}
                    >
                      {sentence}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div style={layerStyle("saved")}>
          <div>
            <div
              style={{
                color: colors.green,
                fontFamily: uiFont,
                fontSize: 17,
                fontWeight: 720,
              }}
            >
              Saved passages
            </div>
            <div
              style={{
                color: colors.muted,
                fontFamily: uiFont,
                fontSize: 11,
                marginTop: 6,
              }}
            >
              2 passages in this book
            </div>
            <div style={{ display: "grid", gap: 10, marginTop: 18 }}>
              {[sentences[6], sentences[3]].map((sentence, index) => {
                const itemIn = tween(frame, 28.45 + index * 0.06, 0.24, fps);
                return (
                  <div
                    key={sentence}
                    style={{
                      background: colors.surface,
                      border: `1px solid ${colors.lineSoft}`,
                      borderRadius: 5,
                      opacity: itemIn,
                      padding: 12,
                      transform: `translate3d(0, ${(1 - itemIn) * 8}px, 0)`,
                    }}
                  >
                    <div
                      style={{
                        alignItems: "center",
                        color: colors.green,
                        display: "flex",
                        fontFamily: uiFont,
                        fontSize: 10,
                        fontWeight: 680,
                        gap: 6,
                      }}
                    >
                      <Bookmark size={11} /> Sentence {index === 0 ? 7 : 4}
                    </div>
                    <div
                      style={{
                        color: colors.muted,
                        fontFamily: uiFont,
                        fontSize: 10,
                        lineHeight: 1.45,
                        marginTop: 7,
                      }}
                    >
                      {sentence}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
};

const ReaderCursor = ({
  frame,
  stage,
}: {
  frame: number;
  stage: ReaderStage;
}) => {
  const { fps } = useVideoConfig();
  const selectionMove = tween(frame, 9.45, 0.82, fps, easeMove);
  const selectionVisible = fadeWindow(frame, 9.18, 12.2, fps);
  const selectionClick = tween(frame, 10.33, 0.14, fps);
  const selectionClickOut = tween(frame, 10.62, 0.2, fps);
  const lookupMove = tween(frame, 15.45, 0.82, fps, easeMove);
  const lookupVisible = fadeWindow(frame, 15.18, 17.15, fps);
  const lookupClick = tween(frame, 16.36, 0.14, fps);
  const lookupClickOut = tween(frame, 16.66, 0.2, fps);

  if (stage !== "sentence" && stage !== "lookup") return null;

  const isSelection = stage === "sentence";
  const move = isSelection ? selectionMove : lookupMove;
  const visible = isSelection ? selectionVisible : lookupVisible;
  const click = isSelection ? selectionClick : lookupClick;
  const clickOut = isSelection ? selectionClickOut : lookupClickOut;
  const start = isSelection ? { x: 1180, y: 640 } : { x: 1120, y: 620 };
  const end = isSelection ? { x: 850, y: 315 } : { x: 865, y: 400 };
  const x = start.x + (end.x - start.x) * move;
  const y = start.y + (end.y - start.y) * move;
  const ringOpacity = click * (1 - clickOut);

  return (
    <>
      <div
        style={{
          color: colors.green,
          left: 0,
          opacity: visible,
          position: "absolute",
          top: 0,
          transform: `translate3d(${x}px, ${y}px, 0) scale(${0.92 + visible * 0.08})`,
          zIndex: 40,
        }}
      >
        <MousePointer2 fill={colors.paper} size={28} strokeWidth={2} />
        {isSelection ? null : (
          <div
            style={{
              background: colors.green,
              borderRadius: 4,
              color: colors.paper,
              fontFamily: uiFont,
              fontSize: 10,
              fontWeight: 680,
              left: 21,
              padding: "5px 7px",
              position: "absolute",
              top: 19,
              whiteSpace: "nowrap",
            }}
          >
            Right-click
          </div>
        )}
      </div>
      <div
        style={{
          border: `2px solid ${colors.green}`,
          borderRadius: "50%",
          height: 34,
          left: end.x - 17,
          opacity: ringOpacity,
          position: "absolute",
          top: end.y - 17,
          transform: `scale(${0.55 + click * 0.85})`,
          width: 34,
          zIndex: 39,
        }}
      />
    </>
  );
};

const BookRail = () => (
  <aside
    style={{
      background: colors.shell,
      borderRight: `1px solid ${colors.line}`,
      padding: 23,
    }}
  >
    <div style={{ alignItems: "center", display: "flex", gap: 14 }}>
      <BookCover compact />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            color: colors.green,
            fontFamily: uiFont,
            fontSize: 14,
            fontWeight: 720,
            lineHeight: 1.18,
          }}
        >
          A Map of Quiet Water
        </div>
        <div
          style={{
            color: colors.muted,
            fontFamily: uiFont,
            fontSize: 10,
            marginTop: 7,
          }}
        >
          Elena Ward
        </div>
      </div>
    </div>
    <div
      style={{
        color: colors.muted,
        fontFamily: uiFont,
        fontSize: 10,
        fontWeight: 680,
        marginTop: 25,
        textTransform: "uppercase",
      }}
    >
      Chapters
    </div>
    <div style={{ display: "grid", gap: 5, marginTop: 10 }}>
      {[
        ["1", "Departures", "42 sentences"],
        ["2", "The Station Clock", "38 sentences"],
        ["3", "Harbor Light", "46 sentences"],
        ["4", "The Islands", "40 sentences"],
      ].map(([number, title, count], index) => (
        <div
          key={number}
          style={{
            background: index === 2 ? colors.greenSoft : "transparent",
            borderLeft:
              index === 2
                ? `3px solid ${colors.green}`
                : "3px solid transparent",
            borderRadius: 4,
            padding: "9px 9px 9px 10px",
          }}
        >
          <div
            style={{
              color: index === 2 ? colors.green : colors.ink,
              fontFamily: uiFont,
              fontSize: 11,
              fontWeight: index === 2 ? 700 : 620,
            }}
          >
            {number}. {title}
          </div>
          <div
            style={{
              color: colors.muted,
              fontFamily: uiFont,
              fontSize: 9,
              marginTop: 3,
            }}
          >
            {count}
          </div>
        </div>
      ))}
    </div>
  </aside>
);

const PlayerRail = ({
  frame,
  stage,
}: {
  frame: number;
  stage: ReaderStage;
}) => {
  const { fps } = useVideoConfig();
  const movingProgress = interpolate(frame, [0, 33 * fps], [0.32, 0.58], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const sentenceNumber =
    stage === "sentence"
      ? 4
      : stage === "lookup"
        ? 5
        : stage === "saved"
          ? 7
          : 3;

  return (
    <div
      style={{
        alignItems: "center",
        background: colors.player,
        borderTop: `1px solid ${colors.line}`,
        display: "grid",
        gridTemplateColumns: "330px 1fr 240px",
        height: 84,
        padding: "0 28px",
      }}
    >
      <div style={{ alignItems: "center", display: "flex", gap: 13 }}>
        <div
          style={{
            alignItems: "center",
            background: colors.green,
            borderRadius: "50%",
            color: colors.paper,
            display: "flex",
            height: 38,
            justifyContent: "center",
            width: 38,
          }}
        >
          <Pause fill={colors.paper} size={16} strokeWidth={1.8} />
        </div>
        <div>
          <div
            style={{
              color: colors.green,
              fontFamily: uiFont,
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            Playing Chapter 3
          </div>
          <div
            style={{
              color: colors.muted,
              fontFamily: uiFont,
              fontSize: 10,
              marginTop: 3,
            }}
          >
            Sentence {sentenceNumber} of 46
          </div>
        </div>
      </div>
      <div style={{ padding: "0 52px" }}>
        <div
          style={{
            background: "rgba(102,109,105,0.22)",
            borderRadius: 4,
            height: 5,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              background: colors.green,
              height: "100%",
              transform: `scaleX(${movingProgress})`,
              transformOrigin: "left center",
              width: "100%",
            }}
          />
        </div>
      </div>
      <div
        style={{
          alignItems: "center",
          color: colors.green,
          display: "flex",
          gap: 15,
          justifyContent: "end",
        }}
      >
        <Volume2 size={18} strokeWidth={1.8} />
        <div
          style={{
            color: colors.muted,
            fontFamily: uiFont,
            fontSize: 11,
          }}
        >
          42% read
        </div>
      </div>
    </div>
  );
};

const ReaderWindow = ({ timelineFrame }: { timelineFrame: number }) => {
  const { fps } = useVideoConfig();
  const stage = getReaderStage(timelineFrame, fps);

  return (
    <AppWindow>
      <div style={{ height: 682, position: "relative" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "270px minmax(0, 1fr) 310px",
            height: 682,
          }}
        >
          <BookRail />
          <main style={{ background: colors.paper, minWidth: 0 }}>
            <div
              style={{
                alignItems: "center",
                borderBottom: `1px solid ${colors.line}`,
                display: "flex",
                height: 76,
                justifyContent: "space-between",
                padding: "0 52px",
              }}
            >
              <div>
                <div
                  style={{
                    color: colors.muted,
                    fontFamily: uiFont,
                    fontSize: 9,
                    fontWeight: 680,
                    textTransform: "uppercase",
                  }}
                >
                  Now reading
                </div>
                <div
                  style={{
                    color: colors.green,
                    fontFamily: uiFont,
                    fontSize: 16,
                    fontWeight: 720,
                    marginTop: 3,
                  }}
                >
                  Harbor Light
                </div>
              </div>
              <div
                style={{
                  color: colors.muted,
                  fontFamily: uiFont,
                  fontSize: 11,
                  textAlign: "right",
                }}
              >
                Chapter 3 of 4
                <br />
                46 sentences
              </div>
            </div>
            <div style={{ padding: "30px 72px 34px", position: "relative" }}>
              <div
                style={{
                  color: colors.green,
                  fontFamily: uiFont,
                  fontSize: 38,
                  fontWeight: 720,
                  lineHeight: 1.03,
                  marginBottom: 25,
                }}
              >
                Harbor Light
              </div>
              <ReaderParagraphs frame={timelineFrame} />
            </div>
          </main>
          <InspectorPanel frame={timelineFrame} />
        </div>
        <ReaderCursor frame={timelineFrame} stage={stage} />
      </div>
      <PlayerRail frame={timelineFrame} stage={stage} />
    </AppWindow>
  );
};

const OpeningScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const appIn = tween(frame, 0.72, 0.85, fps);
  const camera = interpolate(frame, [0, 5.5 * fps], [0, 1], {
    easing: easeMove,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <div style={{ left: 120, position: "absolute", top: 68 }}>
        <Brand />
      </div>
      <div style={{ left: 150, position: "absolute", top: 245 }}>
        <SceneCopy
          eyebrow="Meet Sonelle"
          headline={
            <>
              Read with your eyes.
              <br />
              Listen at your pace.
            </>
          }
          body="A private desktop reader that keeps narration, text, and your place perfectly in step."
          fontSize={74}
          width={720}
        />
      </div>
      <div
        style={{
          left: 885,
          opacity: appIn,
          position: "absolute",
          top: 260,
          transform: `translate3d(${(1 - appIn) * 76}px, ${(1 - appIn) * 38}px, 0) scale(${0.61 + appIn * 0.025 + camera * 0.012})`,
          transformOrigin: "top left",
        }}
      >
        <ReaderWindow timelineFrame={frame} />
      </div>
      <div
        style={{
          left: 1270,
          opacity: appIn,
          position: "absolute",
          top: 705,
          transform: `translate3d(${(1 - appIn) * -46}px, ${(1 - appIn) * 52}px, 0) rotate(-6deg) scale(0.62)`,
        }}
      >
        <BookCover />
      </div>
    </AbsoluteFill>
  );
};

const ImportScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const copyIn = tween(frame, 0.15, 0.5, fps);
  const windowIn = tween(frame, 0.38, 0.7, fps);
  const drag = tween(frame, 1.55, 2.15, fps, easeMove);
  const imported = tween(frame, 3.78, 0.22, fps);
  const openReader = tween(frame, 5.2, 0.44, fps);
  const bookOpacity = 1 - tween(frame, 3.7, 0.2, fps);

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <div style={{ left: 120, position: "absolute", top: 64 }}>
        <Brand />
      </div>
      <div
        style={{
          left: 120,
          opacity: copyIn,
          position: "absolute",
          top: 136,
          transform: `translate3d(0, ${(1 - copyIn) * 16}px, 0)`,
        }}
      >
        <div
          style={{
            color: colors.green,
            fontFamily: uiFont,
            fontSize: 52,
            fontWeight: 710,
            lineHeight: 1,
          }}
        >
          Drop in an EPUB.
          <br />
          Start reading.
        </div>
      </div>
      <div
        style={{
          left: 245,
          opacity: windowIn,
          position: "absolute",
          top: 236,
          transform: `translate3d(0, ${(1 - windowIn) * 32}px, 0) scale(${0.89 + windowIn * 0.03})`,
          transformOrigin: "top left",
        }}
      >
        <div style={{ opacity: 1 - openReader }}>
          <LibraryWindow dragProgress={drag} importedProgress={imported} />
        </div>
        <div
          style={{
            left: 0,
            opacity: openReader,
            position: "absolute",
            top: 0,
            transform: `scale(${0.985 + openReader * 0.015})`,
            transformOrigin: "center",
          }}
        >
          <ReaderWindow timelineFrame={frame - 5.2 * fps} />
        </div>
      </div>
      <div
        style={{
          left: 120,
          opacity: bookOpacity,
          position: "absolute",
          top: 560,
          transform: `translate3d(${drag * 895}px, ${drag * -170}px, 0) rotate(${-7 + drag * 7}deg) scale(${1 - drag * 0.27})`,
          zIndex: 30,
        }}
      >
        <BookCover />
      </div>
    </AbsoluteFill>
  );
};

const tourCopy = [
  {
    stage: "narration" as const,
    eyebrow: "Sentence-synced narration",
    headline: "The voice stays with the page.",
  },
  {
    stage: "sentence" as const,
    eyebrow: "Choose any sentence",
    headline: "Begin exactly where you want.",
  },
  {
    stage: "lookup" as const,
    eyebrow: "Word lookup",
    headline: "Stay curious without leaving the story.",
  },
  {
    stage: "search" as const,
    eyebrow: "Chapter search",
    headline: "Find the passage still on your mind.",
  },
  {
    stage: "saved" as const,
    eyebrow: "Saved passages",
    headline: "Keep the sentences worth returning to.",
  },
];

const TourScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const windowIn = tween(frame, 0.2, 0.65, fps);
  const camera = interpolate(frame, [0, 33 * fps], [0, 1], {
    easing: Easing.linear,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ background: colors.green, overflow: "hidden" }}>
      <div
        style={{
          border: "1px solid rgba(252,249,248,0.09)",
          height: 900,
          left: -320,
          position: "absolute",
          top: -520,
          transform: `translate3d(${camera * 40}px, ${camera * 15}px, 0) rotate(24deg)`,
          width: 900,
        }}
      />
      <div style={{ left: 120, position: "absolute", top: 58 }}>
        <Brand inverse />
      </div>
      {tourCopy.map((copy) => {
        const visibility = stageVisibility(copy.stage, frame, fps);
        const [start, end] = readerStageWindows[copy.stage];
        const direction = frame / fps > (start + end) / 2 ? -1 : 1;
        return (
          <div
            key={copy.eyebrow}
            style={{
              alignItems: "baseline",
              display: "flex",
              filter: `blur(${(1 - visibility) * 1.2}px)`,
              gap: 26,
              left: 470,
              opacity: visibility,
              position: "absolute",
              top: 63,
              transform: `translate3d(0, ${(1 - visibility) * direction * 12}px, 0)`,
            }}
          >
            <div
              style={{
                color: "rgba(252,249,248,0.58)",
                fontFamily: uiFont,
                fontSize: 13,
                fontWeight: 680,
                textTransform: "uppercase",
              }}
            >
              {copy.eyebrow}
            </div>
            <div
              style={{
                color: colors.paper,
                fontFamily: uiFont,
                fontSize: 34,
                fontWeight: 700,
                letterSpacing: 0,
              }}
            >
              {copy.headline}
            </div>
          </div>
        );
      })}
      <div
        style={{
          left: 224,
          opacity: windowIn,
          position: "absolute",
          top: 160,
          transform: `translate3d(0, ${(1 - windowIn) * 34 - camera * 7}px, 0) scale(${0.91 + windowIn * 0.01 + camera * 0.006})`,
          transformOrigin: "top left",
        }}
      >
        <ReaderWindow timelineFrame={frame} />
      </div>
    </AbsoluteFill>
  );
};

const LocalScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const coverIn = tween(frame, 0.5, 0.65, fps);
  const drift = interpolate(frame, [0, 6 * fps], [0, 1], {
    easing: Easing.linear,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ background: colors.paper, overflow: "hidden" }}>
      <div style={{ left: 120, position: "absolute", top: 68 }}>
        <Brand />
      </div>
      <div style={{ left: 165, position: "absolute", top: 238 }}>
        <SceneCopy
          eyebrow="Local-first by design"
          headline={
            <>
              Your library stays
              <br />
              where it belongs.
            </>
          }
          body="Your EPUBs, bookmarks, and reading place stay on your device."
          fontSize={78}
          width={780}
        />
        <div
          style={{
            display: "grid",
            gap: 14,
            marginTop: 34,
          }}
        >
          {[
            "Books you choose",
            "Progress ready to resume",
            "Passages you saved",
          ].map((item, index) => {
            const itemIn = tween(frame, 1.05 + index * 0.055, 0.32, fps);
            return (
              <div
                key={item}
                style={{
                  alignItems: "center",
                  color: colors.green,
                  display: "flex",
                  fontFamily: uiFont,
                  fontSize: 17,
                  fontWeight: 650,
                  gap: 11,
                  opacity: itemIn,
                  transform: `translate3d(0, ${(1 - itemIn) * 10}px, 0)`,
                }}
              >
                <Check size={17} strokeWidth={2.2} /> {item}
              </div>
            );
          })}
        </div>
      </div>
      <div
        style={{
          left: 1160,
          opacity: coverIn,
          position: "absolute",
          top: 230,
          transform: `translate3d(${(1 - coverIn) * 70 - drift * 8}px, ${(1 - coverIn) * 45 - drift * 5}px, 0) rotate(4deg) scale(1.5)`,
        }}
      >
        <BookCover />
      </div>
      <div
        style={{
          background: colors.green,
          borderRadius: 22,
          height: 520,
          left: 1240,
          opacity: coverIn * 0.13,
          position: "absolute",
          top: 285,
          transform: `translate3d(${drift * 12}px, ${drift * 5}px, 0) rotate(-8deg)`,
          width: 390,
        }}
      />
    </AbsoluteFill>
  );
};

const ClosingScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const iconIn = tween(frame, 0.2, 0.45, fps);
  const titleIn = tween(frame, 0.34, 0.62, fps);
  const ctaIn = tween(frame, 0.72, 0.5, fps);
  const appIn = tween(frame, 1.4, 0.72, fps);
  const camera = interpolate(frame, [0, 8 * fps], [0, 1], {
    easing: easeMove,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ background: colors.green, overflow: "hidden" }}>
      <div
        style={{
          left: "50%",
          opacity: iconIn,
          position: "absolute",
          top: 105,
          transform: `translate3d(-50%, ${(1 - iconIn) * 16}px, 0)`,
        }}
      >
        <Brand inverse />
      </div>
      <div
        style={{
          color: colors.paper,
          fontFamily: uiFont,
          fontSize: 82,
          fontWeight: 710,
          left: "50%",
          letterSpacing: 0,
          lineHeight: 0.98,
          opacity: titleIn,
          position: "absolute",
          textAlign: "center",
          top: 215,
          transform: `translate3d(-50%, ${(1 - titleIn) * 28}px, 0)`,
          width: 1080,
        }}
      >
        The story is ready
        <br />
        when you are.
      </div>
      <div
        style={{
          alignItems: "center",
          background: colors.paper,
          borderRadius: 7,
          color: colors.green,
          display: "flex",
          fontFamily: uiFont,
          fontSize: 16,
          fontWeight: 720,
          gap: 9,
          justifyContent: "center",
          left: "50%",
          opacity: ctaIn,
          padding: "13px 19px",
          position: "absolute",
          top: 415,
          transform: `translate3d(-50%, ${(1 - ctaIn) * 16}px, 0) scale(${0.96 + ctaIn * 0.04})`,
        }}
      >
        <Play fill={colors.green} size={15} strokeWidth={1.8} />
        Discover Sonelle
      </div>
      <div
        style={{
          left: 335,
          opacity: appIn,
          position: "absolute",
          top: 570,
          transform: `translate3d(0, ${(1 - appIn) * 58 - camera * 25}px, 0) scale(${0.78 + appIn * 0.02 + camera * 0.012})`,
          transformOrigin: "top left",
        }}
      >
        <ReaderWindow timelineFrame={frame} />
      </div>
    </AbsoluteFill>
  );
};

const OPENING_FRAMES = 165;
const IMPORT_FRAMES = 225;
const TOUR_FRAMES = 990;
const LOCAL_FRAMES = 180;
const CLOSING_FRAMES = 240;
const TRANSITION_FRAMES = 18;

export const SonelleProductFilm = () => {
  const { fps } = useVideoConfig();
  const transition = springTiming({
    config: { damping: 200 },
    durationInFrames: TRANSITION_FRAMES,
  });

  return (
    <AbsoluteFill style={{ background: colors.paper, fontFamily: uiFont }}>
      <GlobalBackdrop />
      <Audio src={staticFile("audio/sonelle-ambient.wav")} volume={0.65} />
      <TransitionSeries>
        <TransitionSeries.Sequence
          durationInFrames={OPENING_FRAMES}
          premountFor={fps}
        >
          <OpeningScene />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={transition}
        />
        <TransitionSeries.Sequence
          durationInFrames={IMPORT_FRAMES}
          premountFor={fps}
        >
          <ImportScene />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={transition}
        />
        <TransitionSeries.Sequence
          durationInFrames={TOUR_FRAMES}
          premountFor={fps}
        >
          <TourScene />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={transition}
        />
        <TransitionSeries.Sequence
          durationInFrames={LOCAL_FRAMES}
          premountFor={fps}
        >
          <LocalScene />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={transition}
        />
        <TransitionSeries.Sequence
          durationInFrames={CLOSING_FRAMES}
          premountFor={fps}
        >
          <ClosingScene />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};
