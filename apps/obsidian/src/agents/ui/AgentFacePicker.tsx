import type { FaceImage } from "@/agents/customAgentFiles";
import { AgentFace } from "@/agents/ui/AgentFace";
import type { PresetFacesState } from "@/agents/ui/usePresetFaces";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ImageIcon } from "lucide-react";
import { Notice } from "obsidian";
import React, { useRef } from "react";

export interface PickedFace {
  image: FaceImage;
  src: string;
  presetId?: string;
}

export interface AgentFacePickerProps {
  presets: PresetFacesState;
  selectedPresetId?: string | null;
  onPick: (face: PickedFace) => void;
}

const UPLOAD_TYPES = "image/png,image/jpeg,image/webp";
const PLACEHOLDER_FACE_COUNT = 12;
const PLACEHOLDER_FACE_CLASS =
  "tw-m-0.5 tw-size-9 tw-rounded-full tw-bg-[linear-gradient(90deg,var(--background-modifier-border)_25%,var(--background-modifier-border-focus)_50%,var(--background-modifier-border)_75%)] tw-bg-[length:200%_100%] tw-animate-[copilot-text-shimmer_2.5s_ease-in-out_infinite] motion-reduce:tw-animate-none";

export function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the image."));
    reader.readAsDataURL(blob);
  });
}

async function decodes(image: Blob): Promise<boolean> {
  try {
    (await createImageBitmap(image)).close();
    return true;
  } catch {
    return false;
  }
}

export function AgentFacePicker({
  presets,
  selectedPresetId,
  onPick,
}: AgentFacePickerProps): React.ReactElement {
  const fileInput = useRef<HTMLInputElement>(null);
  // The face being worn shows as chosen rather than taken, also when another agent wears it.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/939
  const fadedIds =
    presets.status === "ready"
      ? presets.faces
          .map((face) => face.id)
          .filter((id) => presets.usedIds.has(id) && id !== selectedPresetId)
      : [];

  const pickUpload = async (file: File | undefined) => {
    if (!file) return;
    // A file that is not a readable image, such as a renamed document, keeps the current face instead of a broken one.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/939
    if (!(await decodes(file))) {
      new Notice("Couldn't read that image. Choose a PNG, JPEG or WebP file.");
      return;
    }
    onPick({ image: { kind: "upload", image: file }, src: await readAsDataUrl(file) });
  };

  return (
    <div className="tw-flex tw-w-72 tw-flex-col tw-gap-2">
      <div className="tw-text-ui-smaller tw-uppercase tw-tracking-wide tw-text-faint">
        Pick a face
      </div>
      {presets.status !== "failed" && (
        <div className="tw-grid tw-grid-cols-6 tw-gap-2" role="group" aria-label="Preset faces">
          {presets.status === "loading" ? (
            <>
              <span className="tw-sr-only">Loading faces</span>
              {Array.from({ length: PLACEHOLDER_FACE_COUNT }, (_, index) => (
                <span key={index} aria-hidden="true" className={PLACEHOLDER_FACE_CLASS} />
              ))}
            </>
          ) : (
            presets.faces.map((face) => (
              <button
                key={face.id}
                type="button"
                aria-label={face.alt || face.id}
                aria-pressed={face.id === selectedPresetId}
                className={cn(
                  "clickable-icon tw-size-10 tw-rounded-full tw-bg-transparent tw-p-0.5 tw-shadow-none",
                  fadedIds.includes(face.id) && "tw-opacity-30"
                )}
                onClick={() =>
                  onPick({
                    image: { kind: "preset", bytes: face.bytes },
                    src: face.src,
                    presetId: face.id,
                  })
                }
              >
                <AgentFace src={face.src} size="l" selected={face.id === selectedPresetId} />
              </button>
            ))
          )}
        </div>
      )}
      {fadedIds.length > 0 && (
        <div className="tw-text-ui-smaller tw-text-faint">
          Faded faces are already on your team.
        </div>
      )}
      {presets.status === "failed" && (
        <div className="tw-text-ui-smaller tw-text-muted">
          Couldn&apos;t load the preset faces. You can upload an image.
        </div>
      )}
      <div className="tw-border-0 tw-border-t tw-border-solid tw-border-border tw-pt-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => fileInput.current?.click()}
        >
          <ImageIcon className="tw-size-3.5" />
          Upload image
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept={UPLOAD_TYPES}
          aria-label="Upload image"
          className="tw-hidden"
          onChange={(event) => {
            void pickUpload(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
