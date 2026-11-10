import { lazy, type ComponentType } from "react";

/**
 * A lazily loaded component that can be fetched ahead of its first use. Once
 * fetched it renders as an ordinary component, so no loading fallback shows.
 */
export function preloadable<Props>(load: () => Promise<ComponentType<Props>>) {
  let loaded: ComponentType<Props> | undefined;
  let pending: Promise<ComponentType<Props>> | undefined;
  const fetch = () =>
    (pending ??= load().then(
      (component) => (loaded = component),
      (error: unknown) => {
        pending = undefined;
        throw error;
      },
    ));
  const Lazy = lazy(async () => ({ default: await fetch() }));
  return {
    preload(): void {
      void fetch().catch(() => undefined);
    },
    /** The component to render. Choose it once per mount, with `useState`. */
    component: (): ComponentType<Props> => loaded ?? Lazy,
  };
}
