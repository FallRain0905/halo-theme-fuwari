const apiBase = window.location.pathname.startsWith("/photo-admin")
  ? "/photo-api"
  : "";
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  photos: [],
  editing: null,
};

const toast = (message) => {
  const el = $("#toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    el.hidden = true;
  }, 2800);
};

const request = async (path, options = {}) => {
  const headers =
    options.body instanceof FormData
      ? {}
      : { "Content-Type": "application/json" };
  const response = await fetch(`${apiBase}${path}`, {
    credentials: "include",
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
};

const setAuthenticated = (authenticated) => {
  $("#login-panel").hidden = authenticated;
  $$(".authenticated-only").forEach((el) => {
    el.hidden = !authenticated;
  });
};

const formatDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
};

const filteredPhotos = () => {
  const q = $("#admin-search").value.trim().toLowerCase();
  if (!q) return state.photos;
  return state.photos.filter((photo) =>
    `${photo.title} ${photo.description} ${photo.album} ${photo.tags.join(" ")}`
      .toLowerCase()
      .includes(q),
  );
};

const renderList = () => {
  const list = $("#admin-list");
  const photos = filteredPhotos();
  $("#library-meta").textContent =
    `${state.photos.length} photos, ${photos.length} visible`;
  if (!photos.length) {
    list.innerHTML = `<div class="muted">No photos yet.</div>`;
    return;
  }
  list.innerHTML = photos
    .map(
      (photo) => `
        <article class="photo-row" data-id="${photo.id}">
          <img src="${photo.thumb || photo.src}" alt="" loading="lazy" />
          <div>
            <h3>${escapeHtml(photo.title || "Untitled")}</h3>
            <p>${escapeHtml([photo.album, formatDate(photo.takenAt)].filter(Boolean).join(" · "))}</p>
            <div class="tags">${photo.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
          </div>
          <button class="ghost edit-button" type="button">Edit</button>
        </article>
      `,
    )
    .join("");
};

const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"]/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
      })[char],
  );

const loadPhotos = async () => {
  const data = await request("/photos");
  state.photos = data.photos || [];
  renderList();
};

const openEdit = (photo) => {
  state.editing = photo;
  const form = $("#edit-form");
  form.elements.id.value = photo.id;
  form.elements.title.value = photo.title || "";
  form.elements.album.value = photo.album || "";
  form.elements.tags.value = (photo.tags || []).join(", ");
  form.elements.description.value = photo.description || "";
  $("#edit-preview").src = photo.src || photo.thumb;
  $("#edit-dialog").showModal();
};

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await request("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: form.get("email"),
        password: form.get("password"),
      }),
    });
    setAuthenticated(true);
    await loadPhotos();
    toast("Logged in");
  } catch (error) {
    toast(error.message);
  }
});

$("#logout-button").addEventListener("click", async () => {
  await request("/auth/logout", { method: "POST", body: "{}" }).catch(() => {});
  setAuthenticated(false);
});

$("#file-input").addEventListener("change", (event) => {
  const files = [...event.target.files];
  $("#file-summary").textContent = files.length
    ? `${files.length} file(s) selected`
    : "No files selected";
});

$("#upload-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const files = [...form.elements.files.files];
  if (!files.length) return toast("Please choose images first");
  const payload = new FormData();
  payload.append("album", form.elements.album.value);
  payload.append("tags", form.elements.tags.value);
  payload.append("title", form.elements.title.value);
  payload.append("description", form.elements.description.value);
  files.forEach((file) => payload.append("files", file));

  const button = form.querySelector("button[type='submit']");
  button.disabled = true;
  button.textContent = "Uploading...";
  try {
    const data = await request("/photos/upload", {
      method: "POST",
      body: payload,
    });
    toast(`Uploaded ${data.photos?.length || files.length} photo(s)`);
    form.reset();
    $("#file-summary").textContent = "No files selected";
    await loadPhotos();
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Upload and Publish";
  }
});

$("#sync-button").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = "Refreshing...";
  try {
    const data = await request("/sync", { method: "POST", body: "{}" });
    toast(`Imported ${data.imported || 0}, total ${data.total || 0}`);
    await loadPhotos();
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Refresh Index";
  }
});

$("#admin-search").addEventListener("input", renderList);

$("#admin-list").addEventListener("click", (event) => {
  const button = event.target.closest(".edit-button");
  if (!button) return;
  const row = button.closest(".photo-row");
  const photo = state.photos.find((item) => item.id === row.dataset.id);
  if (photo) openEdit(photo);
});

$("#edit-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const id = form.elements.id.value;
  try {
    await request(`/photos/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        title: form.elements.title.value,
        album: form.elements.album.value,
        tags: form.elements.tags.value,
        description: form.elements.description.value,
      }),
    });
    $("#edit-dialog").close();
    toast("Saved");
    await loadPhotos();
  } catch (error) {
    toast(error.message);
  }
});

$("#delete-button").addEventListener("click", async () => {
  if (!state.editing) return;
  if (!window.confirm(`Delete ${state.editing.title || "this photo"}?`)) return;
  try {
    await request(`/photos/${encodeURIComponent(state.editing.id)}`, {
      method: "DELETE",
    });
    $("#edit-dialog").close();
    toast("Deleted");
    await loadPhotos();
  } catch (error) {
    toast(error.message);
  }
});

const boot = async () => {
  try {
    const auth = await request("/auth/me");
    setAuthenticated(auth.authenticated);
    if (auth.authenticated) await loadPhotos();
  } catch {
    setAuthenticated(false);
  }
};

boot();
