import matter from "gray-matter";

export interface FrontmatterResult {
  attributes: Record<string, unknown>;
  body: string;
}

export function parseFrontmatter(content: string): FrontmatterResult {
  const { data, content: body } = matter(content);
  return { attributes: data, body };
}
