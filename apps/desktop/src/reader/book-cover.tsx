import { Show } from "solid-js";

export function BookCover(props: { title: string; src?: string | null; className: string }) {
  return (
    <span class={`book-cover ${props.className}`} aria-hidden="true">
      <Show
        when={props.src}
        fallback={
          <span class="book-cover-fallback">
            <span class="book-cover-monogram">{props.title}</span>
            <span class="book-cover-orbit orbit-one" />
            <span class="book-cover-orbit orbit-two" />
            <span class="book-cover-coral" />
          </span>
        }
      >
        {(src) => <img src={src()} alt="" loading="lazy" />}
      </Show>
    </span>
  );
}
