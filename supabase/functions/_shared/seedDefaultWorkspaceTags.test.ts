import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import { DEFAULT_WORKSPACE_TAGS } from "./seedDefaultWorkspaceTags.ts";
import { EMAIL_CATEGORIES } from "./email-category.ts";

Deno.test("DEFAULT_WORKSPACE_TAGS has 16 entries", () => {
  assertEquals(DEFAULT_WORKSPACE_TAGS.length, 16);
});

Deno.test("every EMAIL_CATEGORY has a matching default tag", () => {
  const tagNames = new Set(DEFAULT_WORKSPACE_TAGS.map((t) => t.name));
  for (const category of EMAIL_CATEGORIES) {
    assertEquals(
      tagNames.has(category),
      true,
      `Missing default tag for category: "${category}"`,
    );
  }
});

Deno.test("every default tag has a non-empty ai_prompt", () => {
  for (const tag of DEFAULT_WORKSPACE_TAGS) {
    assertEquals(
      tag.ai_prompt.trim().length > 0,
      true,
      `Tag "${tag.name}" has empty ai_prompt`,
    );
  }
});

Deno.test("every default tag has a valid hex color", () => {
  const HEX_RE = /^#[0-9a-f]{6}$/i;
  for (const tag of DEFAULT_WORKSPACE_TAGS) {
    assertMatch(tag.color, HEX_RE, `Tag "${tag.name}" has invalid color: ${tag.color}`);
  }
});

Deno.test("every default tag has a non-empty category group", () => {
  for (const tag of DEFAULT_WORKSPACE_TAGS) {
    assertEquals(
      tag.category.trim().length > 0,
      true,
      `Tag "${tag.name}" has empty category`,
    );
  }
});
