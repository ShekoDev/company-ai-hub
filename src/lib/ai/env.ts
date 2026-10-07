/**
 * بيتأكد إن قيمة الـ API key حقيقية مش placeholder من .env.example
 * (زي "sk-..." أو "AIza..." أو "sk-ant-...") — كلهم بينتهوا بـ "..." حرفيًا.
 * من غير الفحص ده، أي provider من غير مفتاح حقيقي كان بيظهر "متاح" في القائمة
 * لحد ما الموظف يجرّبه فعليًا ويطلع له خطأ unauthorized غامض.
 */
export function isRealApiKey(value: string | undefined | null): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.endsWith('...')) return false;
  return true;
}
