import { createContext, useContext, type RefObject } from "react";

/** The page-level scrollable element that SongTable virtualizes against. The library
 * routes own the actual scrollbar (so header/meta content above the table scrolls
 * together with it, same as before virtualization); this just hands SongTable a
 * reference to measure scroll position and visible range against, without SongTable
 * having to own — or nest — a scrollbar of its own. */
export const ScrollContainerContext = createContext<RefObject<HTMLDivElement | null> | null>(null);

export function useScrollContainer() {
  return useContext(ScrollContainerContext);
}
