// Logic gom từ cho Word Cloud — dùng chung giữa Convex (server) và client.
//
// Quy tắc gom nhóm (theo thứ tự):
// 1. Chuẩn hóa: thường hóa, gộp khoảng trắng, bỏ dấu câu/ký hiệu ở hai đầu.
// 2. Gom có dấu ↔ không dấu: "học tập" + "hoc tap" + "Học Tập" → một nhóm.
// 3. Gom lỗi gõ sai 1 ký tự (chỉ với từ khóa ≥ 5 ký tự, gộp nhóm ít vào nhóm nhiều).
// 4. Hiển thị biến thể được gõ nhiều nhất; hòa thì ưu tiên biến thể có dấu.

export type WordCount = { word: string; count: number };

// Chuẩn hóa một câu trả lời thô thành dạng hiển thị chuẩn
export function normalizeAnswer(raw: string): string {
  return raw
    .normalize("NFC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[\s\p{P}\p{S}]+/u, "")
    .replace(/[\s\p{P}\p{S}]+$/u, "")
    .trim();
}

// Khóa gom nhóm: bỏ dấu tiếng Việt + bỏ dấu câu bên trong ("e-learning" ↔ "elearning")
export function foldKey(normalized: string): string {
  return normalized
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[\p{P}\p{S}]+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Đếm số dấu thanh/dấu phụ — dùng để ưu tiên biến thể có dấu khi hòa phiếu
function diacriticWeight(s: string): number {
  const nfd = s.normalize("NFD");
  const marks = nfd.length - nfd.replace(/[\u0300-\u036f]/g, "").length;
  return marks + (s.includes("đ") ? 1 : 0);
}

// Kiểm tra khoảng cách chỉnh sửa (Levenshtein) ≤ 1 — đủ bắt lỗi gõ thiếu/thừa/sai 1 ký tự
function editDistanceAtMost1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length > b.length) [a, b] = [b, a];
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length === b.length) {
      i++;
      j++;
    } else {
      j++;
    }
  }
  return edits + (b.length - j) + (a.length - i) <= 1;
}

type Group = { count: number; variants: Map<string, number> };

// Gom danh sách câu trả lời thô thành danh sách từ + tần suất, sắp giảm dần
export function aggregateWordCloud(rawValues: string[]): WordCount[] {
  const groups = new Map<string, Group>();

  for (const raw of rawValues) {
    const norm = normalizeAnswer(raw);
    if (!norm) continue;
    const key = foldKey(norm) || norm;
    let g = groups.get(key);
    if (!g) {
      g = { count: 0, variants: new Map() };
      groups.set(key, g);
    }
    g.count++;
    g.variants.set(norm, (g.variants.get(norm) ?? 0) + 1);
  }

  // Gộp lỗi gõ: duyệt từ nhóm đông xuống nhóm ít, nhóm ít sáp nhập vào nhóm đông gần giống
  const sorted = Array.from(groups.entries()).sort((a, b) => b[1].count - a[1].count);
  const merged: Array<[string, Group]> = [];
  for (const [key, g] of sorted) {
    const target =
      key.length >= 5
        ? merged.find(([k]) => k.length >= 5 && editDistanceAtMost1(key, k))
        : undefined;
    if (target) {
      target[1].count += g.count;
      for (const [variant, c] of g.variants) {
        target[1].variants.set(variant, (target[1].variants.get(variant) ?? 0) + c);
      }
    } else {
      merged.push([key, g]);
    }
  }

  return merged
    .map(([, g]) => {
      let best = "";
      let bestCount = -1;
      let bestMarks = -1;
      for (const [variant, c] of g.variants) {
        const marks = diacriticWeight(variant);
        if (c > bestCount || (c === bestCount && marks > bestMarks)) {
          best = variant;
          bestCount = c;
          bestMarks = marks;
        }
      }
      return { word: best, count: g.count };
    })
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word, "vi"));
}

// So khớp "từ của tôi" với từ trong cloud (dùng ở phần replay của sinh viên)
export function sameWordGroup(a: string, b: string): boolean {
  const ka = foldKey(normalizeAnswer(a));
  const kb = foldKey(normalizeAnswer(b));
  if (!ka || !kb) return false;
  return ka === kb || (ka.length >= 5 && kb.length >= 5 && editDistanceAtMost1(ka, kb));
}
