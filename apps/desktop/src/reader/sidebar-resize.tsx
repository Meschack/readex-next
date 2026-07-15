import { createSignal } from "solid-js";
import { DEFAULT_READER_PREFERENCES } from "@sonelle/reader";

export type ResizableSidebar = "library" | "inspector";
type SidebarEdge = "left" | "right";

export interface SidebarWidthBounds {
  min: number;
  max: number;
}

interface SidebarResizeHandleProps {
  sidebar: ResizableSidebar;
  edge: SidebarEdge;
  width: number;
  defaultWidth: number;
  getBounds: () => SidebarWidthBounds;
  onWidthChange: (width: number) => void;
}

interface SidebarResizeBoundsInput {
  sidebar: ResizableSidebar;
  viewportWidth: number;
  oppositeSidebarWidth: number;
}

export const sidebarDefaultWidths: Record<ResizableSidebar, number> = {
  library: DEFAULT_READER_PREFERENCES.libraryRailWidth,
  inspector: DEFAULT_READER_PREFERENCES.inspectorRailWidth
};

const sidebarWidthLimits: Record<ResizableSidebar, SidebarWidthBounds> = {
  library: { min: 220, max: 400 },
  inspector: { min: 280, max: 440 }
};

const minimumReaderWidth = 560;
const keyboardResizeStep = 16;
const keyboardLargeResizeStep = 64;

export function getSidebarResizeBounds(input: SidebarResizeBoundsInput): SidebarWidthBounds {
  const limits = sidebarWidthLimits[input.sidebar];
  const availableWidth = input.viewportWidth - input.oppositeSidebarWidth - minimumReaderWidth;
  const max = Math.max(limits.min, Math.min(limits.max, availableWidth));

  return { min: limits.min, max };
}

export function clampSidebarWidth(width: number, bounds: SidebarWidthBounds): number {
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(width)));
}

export function resolveSidebarResize(
  startWidth: number,
  pointerDelta: number,
  edge: SidebarEdge,
  bounds: SidebarWidthBounds
): number {
  const nextWidth = edge === "right" ? startWidth + pointerDelta : startWidth - pointerDelta;

  return clampSidebarWidth(nextWidth, bounds);
}

export function SidebarResizeHandle(props: SidebarResizeHandleProps) {
  const [isResizing, setIsResizing] = createSignal(false);
  let activePointerId: number | null = null;
  let startX = 0;
  let startWidth = 0;

  const endResize = (event: PointerEvent & { currentTarget: HTMLDivElement }) => {
    if (activePointerId !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    activePointerId = null;
    setIsResizing(false);
  };

  const resizeFromKeyboard = (pointerDelta: number) => {
    props.onWidthChange(
      resolveSidebarResize(props.width, pointerDelta, props.edge, props.getBounds())
    );
  };

  return (
    <div
      classList={{
        "sidebar-resize-handle": true,
        "is-resizing": isResizing()
      }}
      data-sidebar={props.sidebar}
      role="separator"
      aria-label={`Resize ${props.sidebar} sidebar`}
      aria-orientation="vertical"
      aria-valuemin={props.getBounds().min}
      aria-valuemax={props.getBounds().max}
      aria-valuenow={props.width}
      aria-valuetext={`${props.width} pixels`}
      tabIndex={0}
      title={`Resize ${props.sidebar} sidebar`}
      onPointerDown={(event) => {
        if (event.button !== 0) return;

        activePointerId = event.pointerId;
        startX = event.clientX;
        startWidth = props.width;
        event.currentTarget.setPointerCapture(event.pointerId);
        setIsResizing(true);
        event.preventDefault();
      }}
      onPointerMove={(event) => {
        if (activePointerId !== event.pointerId) return;

        props.onWidthChange(
          resolveSidebarResize(startWidth, event.clientX - startX, props.edge, props.getBounds())
        );
      }}
      onPointerUp={endResize}
      onPointerCancel={endResize}
      onLostPointerCapture={() => {
        activePointerId = null;
        setIsResizing(false);
      }}
      onDblClick={() =>
        props.onWidthChange(clampSidebarWidth(props.defaultWidth, props.getBounds()))
      }
      onKeyDown={(event) => {
        switch (event.key) {
          case "ArrowLeft":
            resizeFromKeyboard(-keyboardResizeStep);
            break;
          case "ArrowRight":
            resizeFromKeyboard(keyboardResizeStep);
            break;
          case "PageDown":
            resizeFromKeyboard(-keyboardLargeResizeStep);
            break;
          case "PageUp":
            resizeFromKeyboard(keyboardLargeResizeStep);
            break;
          case "Home":
            props.onWidthChange(props.getBounds().min);
            break;
          case "End":
            props.onWidthChange(props.getBounds().max);
            break;
          default:
            return;
        }

        event.preventDefault();
      }}
    />
  );
}
