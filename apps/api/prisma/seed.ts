import "dotenv/config";
import { Database } from "../src/database";
const db = new Database();
async function main() {
  await db.character.upsert({
    where: { id: "yuna" },
    update: {},
    create: {
      id: "yuna",
      name: "Yuna",
      personality: "ร่าเริง ขี้เล่น ซึนเดเระเล็กน้อย ใส่ใจผู้ใช้",
      systemPrompt:
        "พูดภาษาไทยเป็นหลัก ตอบกระชับอย่างเป็นธรรมชาติ ใช้ความทรงจำที่ได้รับเท่านั้น",
    },
  });
}
main().finally(() => db.$disconnect());
