/**
 * © JamvanHax0r — Fiony Bot
 * uploadFile.js — Upload file umum (dokumen/audio/video/dll).
 * Prioritas: top4top -> fallback tmpfiles.org kalau top4top gagal/nolak tipe filenya.
 */
import axios from "axios";
import { fileTypeFromBuffer } from "file-type";
import FormData from "form-data";
import top4topUpload from "./t4t.js";

const tmpFiles = async (buffer) => {
  const { ext, mime } = await fileTypeFromBuffer(buffer);
  const form = new FormData();

  form.append("file", buffer, {
    filename: `${Math.floor(Math.random() * 90000)}.${ext}`,
    contentType: mime,
  });

  const response = await axios.post(
    "https://tmpfiles.org/api/v1/upload",
    form,
    {
      headers: {
        ...form.getHeaders(),
      },
    },
  );

  return response.data.data.url.replace("tmpfiles.org/", "tmpfiles.org/dl/");
};

export default async (inp) => {
  let err = false;
  for (const upload of [top4topUpload, tmpFiles]) {
    try {
      return await upload(inp);
    } catch (e) {
      err = e;
    }
  }
  if (err) throw err;
};
