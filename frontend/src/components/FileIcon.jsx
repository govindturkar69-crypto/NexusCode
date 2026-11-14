import { Braces, File, FileCode2, FileImage, FileText } from "lucide-react";

const CODE = new Set(["py", "js", "mjs", "cjs", "jsx", "ts", "tsx", "java", "c", "cpp", "h", "cs", "go", "rs", "rb", "php", "css", "scss", "html", "htm", "sql", "sh", "kt", "swift"]);
const DATA = new Set(["json", "yml", "yaml", "toml", "ini", "xml"]);
const TEXT = new Set(["md", "txt", "csv", "log", "rst"]);
const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp"]);

// A file-type icon from the name's extension (decorative)
function FileIcon({ name, size = 14 }) {
  const ext = String(name).split(".").pop().toLowerCase();
  const Icon = CODE.has(ext) ? FileCode2 : DATA.has(ext) ? Braces : TEXT.has(ext) ? FileText : IMAGE.has(ext) ? FileImage : File;
  return <Icon size={size} className={`file-icon file-icon--${CODE.has(ext) ? "code" : DATA.has(ext) ? "data" : "text"}`} aria-hidden="true" />;
}

export default FileIcon;
