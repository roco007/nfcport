import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

const MAX_MAPPING_JSON_BYTES = 2 * 1024 * 1024;

function assertImportSize(size: number): void {
  if (size > MAX_MAPPING_JSON_BYTES) {
    throw new Error("Choose a JSON file that is 2 MiB or smaller.");
  }
}

function safeJsonFileName(fileName: string): string {
  const baseName = fileName
    .trim()
    .split(/[\\/]/)
    .pop()
    ?.replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^\.+/, "");
  const name = baseName || "nfc-tags";
  return name.toLowerCase().endsWith(".json") ? name : `${name}.json`;
}

export async function pickMappingJsonFile(): Promise<{
  name: string;
  contents: string;
} | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: "*/*",
    copyToCacheDirectory: true,
    multiple: false,
    base64: false,
  });

  if (result.canceled) return null;

  const asset = result.assets[0];
  if (!asset) throw new Error("No file was selected.");
  if (asset.size !== undefined) assertImportSize(asset.size);

  if (Platform.OS === "web") {
    const browserFile = asset.file ?? result.output?.item(0);
    if (!browserFile) {
      throw new Error("The selected file could not be read in this browser.");
    }
    assertImportSize(browserFile.size);
    const contents = await browserFile.text();
    assertImportSize(new Blob([contents]).size);
    return { name: asset.name, contents };
  }

  const nativeFile = new File(asset.uri);
  assertImportSize(nativeFile.size);
  const contents = await nativeFile.text();
  assertImportSize(new Blob([contents]).size);
  return { name: asset.name, contents };
}

export async function exportMappingJsonFile(
  contents: string,
  fileName: string,
): Promise<void> {
  const name = safeJsonFileName(fileName);

  if (Platform.OS === "web") {
    const url = URL.createObjectURL(
      new Blob([contents], { type: "application/json;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    try {
      link.click();
    } finally {
      link.remove();
      globalThis.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    }
    return;
  }

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("File sharing is unavailable on this device.");
  }

  const file = new File(Paths.cache, name);
  file.create({ overwrite: true });
  file.write(contents, { encoding: "utf8" });
  await Sharing.shareAsync(file.uri, {
    dialogTitle: "Export tag mapping",
    mimeType: "application/json",
    UTI: "public.json",
  });
}
