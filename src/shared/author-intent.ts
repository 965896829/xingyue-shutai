/** Conservative host authorization for a reversible edit of the selected object. */
export function explicitlyRequestsEdit(text: string) {
  const request = text.trim();
  if (/[?？]|(?:为什么|为何|怎么|如何|是否|能不能|可不可以|不要改|别改|先讨论|只讨论|举例)/.test(request)) return false;
  return /^(?:请|帮我|麻烦|现在|直接|把|将|修改|改成|改为|调整|重写|删掉|删除|替换)/.test(request) &&
    /(?:修改|改成|改为|调整|重写|删掉|删除|替换)/.test(request);
}
