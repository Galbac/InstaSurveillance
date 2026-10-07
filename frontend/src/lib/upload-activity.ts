const active = new Set<object>();
export function uploadIsActive() {
  return active.size > 0;
}
export function setUploadActivity(owner: object, busy: boolean) {
  if (busy) active.add(owner);
  else active.delete(owner);
  window.dispatchEvent(
    new CustomEvent("insta-upload-active", { detail: uploadIsActive() }),
  );
}
