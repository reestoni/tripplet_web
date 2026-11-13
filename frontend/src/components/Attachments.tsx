import { useEffect, useState } from "react";
import { request } from "../api";
import { useI18n } from "../i18n";

type Item = { id: number; name: string };
type Data = { images: Item[]; pdfs: Item[] };

/** Images and PDFs attached to the series: buttons in the header + a gallery overlay. */
export default function Attachments({ seriesId }: { seriesId: number }) {
  const { t } = useI18n();
  const [data, setData] = useState<Data | null>(null);
  const [open, setOpen] = useState<"image" | "pdf" | null>(null);
  const [big, setBig] = useState<Item | null>(null);

  useEffect(() => {
    request<Data>("GET", `/api/series/${seriesId}/attachments`).then(setData).catch(() => setData(null));
  }, [seriesId]);

  if (!data || (data.images.length === 0 && data.pdfs.length === 0)) return null;
  const url = (kind: string, id: number) => `/api/series/${seriesId}/attachments/${kind}/${id}`;

  return (
    <>
      {data.images.length > 0 && (
        <button className="link-btn" onClick={() => setOpen("image")}>{t("at.images", { n: data.images.length })}</button>
      )}
      {data.pdfs.length > 0 && (
        <button className="link-btn" onClick={() => setOpen("pdf")}>{t("at.pdfs", { n: data.pdfs.length })}</button>
      )}
      {open && (
        <div className="modal-back" onClick={() => { setOpen(null); setBig(null); }}>
          <div className="modal at-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="at-head">
              <h2>{open === "image" ? t("at.imagesTitle") : t("at.pdfsTitle")}</h2>
              <button className="btn-plain" onClick={() => { setOpen(null); setBig(null); }}>{t("at.close")}</button>
            </div>
            {open === "pdf" && (
              <ul className="at-list">
                {data.pdfs.map((p) => (
                  <li key={p.id}><a href={url("pdf", p.id)} target="_blank" rel="noreferrer">{p.name}</a></li>
                ))}
              </ul>
            )}
            {open === "image" && !big && (
              <div className="at-grid">
                {data.images.map((im) => (
                  <button key={im.id} className="at-thumb" onClick={() => setBig(im)} title={im.name}>
                    <img src={url("image", im.id)} alt={im.name} loading="lazy" />
                    <span>{im.name}</span>
                  </button>
                ))}
              </div>
            )}
            {open === "image" && big && (
              <div className="at-big">
                <button className="btn-plain" onClick={() => setBig(null)}>← {t("at.all")}</button>
                <a href={url("image", big.id)} target="_blank" rel="noreferrer" title={t("at.newTab")}>
                  <img src={url("image", big.id)} alt={big.name} />
                </a>
                <div className="muted">{big.name}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
