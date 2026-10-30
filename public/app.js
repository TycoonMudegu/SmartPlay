const manifestUrl = `${location.origin}/manifest.json`;
const field = document.getElementById('manifest-url');
field.value = manifestUrl;
document.getElementById('install-link').href = manifestUrl.replace(/^https?:\/\//, 'stremio://');
document.getElementById('copy-link').addEventListener('click', async () => {
  const status = document.getElementById('copy-status');
  try {
    await navigator.clipboard.writeText(manifestUrl);
    status.textContent = 'Copied. Paste the link into Stremio’s Add-ons search field.';
  } catch {
    field.focus();
    field.select();
    status.textContent = 'Select and copy the installation link above.';
  }
});
