"use client";

import { useEffect, useState } from "react";
import {
  createScheduleImage,
  scheduleImageFileName,
  type ImageSchedulePayload
} from "../lib/schedule-image";

type Props = {
  checkedMatches?: ReadonlySet<number>;
  payload: ImageSchedulePayload;
};

export default function ScheduleImageButton({ checkedMatches = new Set(), payload }: Props) {
  const [creating, setCreating] = useState(false);
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  async function openImageModal() {
    setCreating(true);
    setError("");

    try {
      const blob = await createScheduleImage(payload, checkedMatches);
      const nextUrl = URL.createObjectURL(blob);
      setImageBlob(blob);
      setImageUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return nextUrl;
      });
      setModalOpen(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "画像を作成できませんでした。");
    } finally {
      setCreating(false);
    }
  }

  async function saveImage() {
    if (!imageBlob || !imageUrl) return;
    const fileName = scheduleImageFileName(payload);
    const file = new File([imageBlob], fileName, { type: "image/png" });

    try {
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: payload.title || "ピックルボール乱数表"
        });
        return;
      }

      const anchor = document.createElement("a");
      anchor.href = imageUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError("保存できない場合は、画像を長押しして保存してください。");
    }
  }

  return (
    <>
      <button className="share image-save-button" type="button" onClick={() => void openImageModal()} disabled={creating}>
        {creating ? "画像を作成中..." : "画像を保存"}
      </button>
      {error ? <div className="error image-save-error" role="alert">{error}</div> : null}

      {modalOpen ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="schedule-image-title" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setModalOpen(false);
        }}>
          <div className="modal schedule-image-modal">
            <button className="modal-close" type="button" aria-label="閉じる" onClick={() => setModalOpen(false)}>×</button>
            <h2 id="schedule-image-title">対戦表を画像で保存</h2>
            <p>下のボタンから保存してください。保存した画像は、その後に対戦表が変更されても自動更新されません。</p>
            <div className="schedule-image-preview">
              <img src={imageUrl} alt="保存用の対戦表プレビュー" />
            </div>
            <p className="schedule-image-hint">保存できない場合は、画像を長押しして保存できます。</p>
            <div className="modal-actions">
              <button className="secondary" type="button" onClick={() => setModalOpen(false)}>閉じる</button>
              <button className="primary" type="button" onClick={() => void saveImage()}>スマホに保存</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
