import { google } from "googleapis";
import fs from "node:fs";
import { GoogleAuth } from "google-auth-library";

let cachedAuth = null;

export async function getAuthClient(credentialsJson) {
  if (cachedAuth) return cachedAuth;

  const credentials = typeof credentialsJson === "string"
    ? JSON.parse(credentialsJson)
    : credentialsJson;

  const auth = new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  });

  cachedAuth = auth;
  return auth;
}

export async function uploadFile(folderId, filePath, fileName, credentialsJson) {
  const auth = await getAuthClient(credentialsJson);
  const drive = google.drive({ version: "v3", auth });

  const fileMetadata = { name: fileName, parents: [folderId] };
  const media = { mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", body: fs.createReadStream(filePath) };

  const res = await drive.files.create({ resource: fileMetadata, media, fields: "id" });
  return res.data.id;
}
