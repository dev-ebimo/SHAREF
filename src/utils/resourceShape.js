// Shared by every route that returns a resource list — bookmarks, browse
// (recent/trending/continue-learning), search, my-uploads, etc. Mirrors
// the original browseController.js's shapeResource/formatFileSize exactly,
// just reading D1's snake_case columns instead of a Mongoose document.

export function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function shapeResource(r) {
  return {
    id: r.id,
    title: r.title,
    course: r.course,
    type: r.type,
    department: r.department,
    level: r.level,
    semester: r.semester,
    session: r.session,
    size: formatFileSize(r.file_size_bytes),
    pages: r.pages,
    downloads: r.downloads,
    date: r.created_at,
  };
}

// The DB stores level as "300"; screens that show it standalone want "300 Level".
export function levelLabel(level) {
  return level ? `${level} Level` : "";
}
