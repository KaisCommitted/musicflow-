import { AnimatePresence, motion } from "framer-motion";
import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Volume2, X } from "lucide-react";
import type { Song } from "@/lib/api";
import { AlbumArt } from "@/components/AlbumArt";
import { usePlayer } from "@/store/player";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

function QueueRow({
  song,
  id,
  index,
  isCurrent,
}: {
  song: Song;
  id: string;
  index: number;
  isCurrent: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const jumpTo = usePlayer((s) => s.jumpTo);
  const removeFromQueue = usePlayer((s) => s.removeFromQueue);

  return (
    <motion.li
      ref={setNodeRef}
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2 }}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group flex items-center gap-2 overflow-hidden rounded-lg px-2 py-2 hover-row",
        isCurrent && "bg-primary/10",
        isDragging && "opacity-80 shadow-elevated",
      )}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
        aria-label={`Reorder ${song.title}`}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <button
        onClick={() => jumpTo(index)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <AlbumArt song={song} className="h-9 w-9 shrink-0 rounded-md" />
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-sm", isCurrent && "font-semibold text-primary")}>
            {song.title}
          </span>
          <span className="block truncate text-xs text-muted-foreground">{song.artist}</span>
        </span>
        {isCurrent ? (
          <Volume2 className="h-4 w-4 shrink-0 text-primary" />
        ) : (
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {formatTime(song.duration)}
          </span>
        )}
      </button>
      <button
        onClick={() => removeFromQueue(index)}
        aria-label={`Remove ${song.title} from queue`}
        className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
      >
        <X className="h-4 w-4" />
      </button>
    </motion.li>
  );
}

export function QueuePanel() {
  // Individually selected, not destructured from usePlayer() as a whole — this component is
  // always mounted (AppShell renders it unconditionally), so a whole-store subscription means
  // a full re-render — including every row, each with its own dnd-kit sortable setup — on every
  // `currentTime` tick (several times a second while something plays), whether or not the
  // drawer is even open. Selecting each field means React only re-renders when that field
  // actually changes.
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const queueOpen = usePlayer((s) => s.queueOpen);
  const setQueueOpen = usePlayer((s) => s.setQueueOpen);
  const reorderQueue = usePlayer((s) => s.reorderQueue);
  const context = usePlayer((s) => s.context);

  const ids = queue.map((s, i) => `${s.id}::${i}`);

  const onDragEnd = (e: DragEndEvent) => {
    const from = ids.indexOf(String(e.active.id));
    const to = e.over ? ids.indexOf(String(e.over.id)) : -1;
    if (from >= 0 && to >= 0 && from !== to) reorderQueue(from, to);
  };

  return (
    <AnimatePresence>
      {queueOpen && (
        <motion.aside
          // Animating `width` itself (not just a transform) is what makes the main content
          // next to this reflow smoothly instead of snapping — flexbox recalculates the
          // sibling's size on every frame the width changes, so the song table resizes in
          // lockstep instead of jumping the instant this mounts/unmounts. A duration-based
          // tween instead of a spring avoids the width overshooting and bouncing, which read
          // as janky rather than smooth on something this wide. The inner div below stays a
          // fixed 340px so its content doesn't itself get squeezed during the animation —
          // only the outer clipped box changes size.
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 340, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.4, ease: "easeInOut" }}
          className="flex shrink-0 overflow-hidden border-l border-border bg-card/60"
        >
          <div className="flex w-[340px] shrink-0 flex-col">
            <header className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">Queue</h2>
                <p className="text-xs text-muted-foreground">
                  {context ? context.label : "Nothing playing"} · {queue.length} tracks
                </p>
              </div>
              <button
                onClick={() => setQueueOpen(false)}
                aria-label="Close queue"
                className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto p-2">
              {queue.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">The queue is empty.</p>
              ) : (
                <DndContext
                  collisionDetection={closestCenter}
                  modifiers={[restrictToVerticalAxis]}
                  onDragEnd={onDragEnd}
                >
                  <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                    <ul className="space-y-1">
                      <AnimatePresence initial={false}>
                        {queue.map((song, i) => (
                          <QueueRow
                            key={ids[i]}
                            id={ids[i]!}
                            song={song}
                            index={i}
                            isCurrent={i === index}
                          />
                        ))}
                      </AnimatePresence>
                    </ul>
                  </SortableContext>
                </DndContext>
              )}
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
