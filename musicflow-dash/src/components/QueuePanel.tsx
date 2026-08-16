import { AnimatePresence, motion } from "framer-motion";
import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
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
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group flex items-center gap-2 rounded-lg px-2 py-2 hover-row",
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
          <span
            className={cn("block truncate text-sm", isCurrent && "font-semibold text-primary")}
          >
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
    </li>
  );
}

export function QueuePanel() {
  const { queue, index, queueOpen, setQueueOpen, reorderQueue, context } = usePlayer();

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
          initial={{ x: 360, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 360, opacity: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 34 }}
          className="flex w-[340px] shrink-0 flex-col border-l border-border bg-card/60"
        >
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
                    {queue.map((song, i) => (
                      <QueueRow
                        key={ids[i]}
                        id={ids[i]!}
                        song={song}
                        index={i}
                        isCurrent={i === index}
                      />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
