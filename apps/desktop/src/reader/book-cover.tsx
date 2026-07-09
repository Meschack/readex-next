import { Show } from "solid-js";
import { bookInitials } from "./reader-formatting";

export function BookCover(props: { title: string; src?: string | null; className: string }) {
  return (
    <span class={`book-cover ${props.className}`} aria-hidden="true">
      <Show when={props.src} fallback={bookInitials(props.title)}>
        {(src) => <img src={src()} alt="" loading="lazy" />}
      </Show>
    </span>
  );
}
