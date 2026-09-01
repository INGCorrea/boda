/* =========================================================
   1) CONFIGURA AQUÍ
   =========================================================
   - Cambia los nombres/fecha si quieres (también hay una copia
     en index.html, en el <h1> y en el <p id="hero-date">).
   - Pega la configuración de tu proyecto de Firebase abajo.
     La sacas de: Firebase Console > ⚙️ Configuración del proyecto
     > tus apps > Config (elige "Config", no "npm").
========================================================= */

const firebaseConfig = {
  apiKey: "AIzaSyDTds3WEM1jC8w-KNXQgErOxTRGcLjCzao",
  authDomain: "bodabrisaldo.firebaseapp.com",
  projectId: "bodabrisaldo",
  storageBucket: "bodabrisaldo.firebasestorage.app",
  messagingSenderId: "97803090517",
  appId: "1:97803090517:web:5ca80e109d3e7fbc3c72dc",
  measurementId: "G-VPVDL2BMEP"
};

/* ========================================================= */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getFirestore,
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  serverTimestamp,
  deleteDoc,
  doc,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-storage.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, "bodabase");
const storage = getStorage(app);

const MASTER_KEY = "BODA2026";
const MASTER_STORAGE_KEY = "boda-master-key";
let masterUnlocked = sessionStorage.getItem(MASTER_STORAGE_KEY) === "1";
let lastSnapshotDocs = [];

const form = document.getElementById("upload-form");
const fileInput = document.getElementById("photo-input");
const nameInput = document.getElementById("guest-name");
const submitBtn = document.getElementById("submit-btn");
const statusEl = document.getElementById("status");
const previewWrap = document.getElementById("preview-wrap");
const previewImg = document.getElementById("preview-img");
const previewVideo = document.getElementById("preview-video");
const timelineEl = document.getElementById("timeline");
const timelineEmptyEl = document.getElementById("timeline-empty");
const autoUploadCheckbox = document.getElementById("auto-upload");
const progressEl = document.getElementById("upload-progress");
const masterToggleBtn = document.getElementById("master-toggle");

function isMasterMode() {
  return masterUnlocked;
}

function updateMasterButtonState() {
  if (!masterToggleBtn) return;
  masterToggleBtn.classList.toggle("is-active", isMasterMode());
  masterToggleBtn.textContent = isMasterMode() ? "Modo maestro ON" : "Modo maestro";
}

function toggleMasterMode() {
  if (isMasterMode()) {
    masterUnlocked = false;
    sessionStorage.removeItem(MASTER_STORAGE_KEY);
    updateMasterButtonState();
    renderTimelineFromDocs(lastSnapshotDocs);
    setStatus("Modo maestro desactivado.", "");
    return;
  }

  const enteredKey = prompt("Ingresa la llave maestra para activar el modo de eliminación:");
  if (enteredKey === null) return;

  if (enteredKey.trim() === MASTER_KEY) {
    masterUnlocked = true;
    sessionStorage.setItem(MASTER_STORAGE_KEY, "1");
    updateMasterButtonState();
    renderTimelineFromDocs(lastSnapshotDocs);
    setStatus("Modo maestro activado.", "is-ok");
    return;
  }

  alert("Llave incorrecta.");
}

if (masterToggleBtn) {
  masterToggleBtn.addEventListener("click", toggleMasterMode);
  updateMasterButtonState();
}

// Compresión cliente para videos grandes (sin costo de terceros)
const MAX_VIDEO_MB = 150; // umbral por defecto para comprimir (150 MB permite ~30s sin compresión en la mayoría de casos)
const MAX_VIDEO_SIZE = MAX_VIDEO_MB * 1024 * 1024;

async function compressVideo(file, targetWidth = 1280, targetBitsPerSecond = 1200000) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";

    video.addEventListener("loadedmetadata", () => {
      const ratio = video.videoWidth / video.videoHeight || 16 / 9;
      const width = Math.min(targetWidth, video.videoWidth || targetWidth);
      const height = Math.round(width / ratio);

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");

      const stream = canvas.captureStream(30);
      let mimeType = "video/webm;codecs=vp8";
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = "video/webm";

      const options = { mimeType, bitsPerSecond: targetBitsPerSecond };
      const recorded = [];
      const recorder = new MediaRecorder(stream, options);
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size) recorded.push(e.data);
      };
      recorder.onerror = (e) => reject(e);

      // Dibujar frames continuamente
      let rafId;
      function drawFrame() {
        try {
          ctx.drawImage(video, 0, 0, width, height);
        } catch (e) {
          // ignorar errores al dibujar
        }
        rafId = requestAnimationFrame(drawFrame);
      }

      recorder.onstop = () => {
        cancelAnimationFrame(rafId);
        const blob = new Blob(recorded, { type: options.mimeType.split(';')[0] });
        URL.revokeObjectURL(url);
        resolve(blob);
      };

      recorder.start(1000);
      video.play().catch(() => {
        // algunos navegadores requieren interacción; en ese caso rechazamos
      });
      drawFrame();

      video.addEventListener("ended", () => {
        try {
          recorder.stop();
        } catch (e) {
          // ya detenido
        }
      });
    });

    video.addEventListener("error", (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    });
  });
}

/* ---------- Vista previa al elegir foto ---------- */
fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (!file) {
    previewWrap.hidden = true;
    previewImg.hidden = true;
    previewVideo.hidden = true;
    previewImg.src = "";
    previewVideo.src = "";
    return;
  }

  // Mostrar vista previa según el tipo MIME
  if (file.type && file.type.startsWith("image/")) {
    previewVideo.hidden = true;
    previewVideo.src = "";
    previewImg.src = URL.createObjectURL(file);
    previewImg.hidden = false;
  } else if (file.type && file.type.startsWith("video/")) {
    previewImg.hidden = true;
    previewImg.src = "";
    previewVideo.src = URL.createObjectURL(file);
    previewVideo.hidden = false;
  } else {
    // Otros tipos: intentar mostrar como imagen
    previewVideo.hidden = true;
    previewVideo.src = "";
    previewImg.src = URL.createObjectURL(file);
    previewImg.hidden = false;
  }

  previewWrap.hidden = false;
});

/* ---------- Subir al elegir foto (opcional) ----------
   Si prefieres que la foto se suba inmediatamente al elegirla
   (sin hacer click en "Subir foto"), se puede usar este
   listener. Mantiene la misma lógica de compresión/ubicación.
*/
fileInput.addEventListener("change", async (e) => {
  const archivo = e.target.files[0];
  if (!archivo) return;

  // Solo subir automáticamente si el usuario lo marcó
  if (!autoUploadCheckbox || !autoUploadCheckbox.checked) return;

  let ubicacion = null;
  try {
    ubicacion = await obtenerUbicacion();
  } catch (err) {
    ubicacion = null;
  }

  await subirFotoYDatos(archivo, ubicacion);
});

async function subirFotoYDatos(file, ubicacion) {
  submitBtn.disabled = true;
  setStatus("Preparando imagen…", "");
  progressEl.hidden = true;

  try {
    // Si es video y excede el umbral, intentamos comprimir en cliente
    let fileToUpload = file;
    if (file && file.type && file.type.startsWith("video/") && file.size > MAX_VIDEO_SIZE) {
      setStatus(`Comprimiendo video (${Math.round(file.size / 1024 / 1024)} MB)...`, "");
      try {
        const compressed = await compressVideo(file, 1280, 1200000);
        if (compressed && compressed.size) {
          fileToUpload = compressed;
          setStatus(`Video comprimido: ${Math.round(compressed.size / 1024 / 1024)} MB — subiendo...`, "");
        }
      } catch (err) {
        console.warn("Compresión fallida, subiendo original:", err);
        setStatus("No se pudo comprimir; subiendo el archivo original...", "");
      }
    }

    const blob = await comprimirImagen(fileToUpload);

    // Determinar MIME y extensión
    const mime = (blob && blob.type) || (file && file.type) || "application/octet-stream";
    let ext = "bin";
    if (file && file.name && file.name.includes('.')) {
      ext = file.name.split('.').pop();
    } else if (mime && mime.includes('/')) {
      ext = mime.split('/').pop();
    }

    const nombreArchivo = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const sRef = storageRef(storage, `fotos/${nombreArchivo}`);

    // Subida con progreso (uploadBytesResumable maneja mejor CORS)
    const uploadTask = uploadBytesResumable(sRef, blob, { contentType: mime });

    await new Promise((resolve, reject) => {
      uploadTask.on(
        "state_changed",
        (snap) => {
          const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
          progressEl.hidden = false;
          progressEl.value = pct;
          setStatus(`Subiendo tu archivo… ${pct}%`, "");
        },
        (err) => {
          console.error("Error detectado en la subida:", err);
          alert(
            "¡Ups! Parece que tu navegador o un bloqueador de red (Ad-blocker) impidió subir la foto. \n\n" +
              "Por favor, desactiva temporalmente el bloqueador de anuncios o intenta usar tus datos móviles para poder compartir tu foto. 📸"
          );
          reject(err);
        },
        () => resolve()
      );
    });

    const url = await getDownloadURL(sRef);

    await addDoc(collection(db, "fotos"), {
      url,
      tipo: mime,
      invitado: (nameInput.value || "").trim() || "Invitado anónimo",
      ubicacion: ubicacion
        ? { lat: ubicacion.lat, lng: ubicacion.lng, etiqueta: ubicacion.etiqueta }
        : null,
      creado: serverTimestamp(),
    });

    setStatus("¡Archivo subido! Ya aparece en la línea de tiempo.", "is-ok");
    form.reset();
    previewWrap.hidden = true;
    previewImg.src = "";
    previewVideo.src = "";
    previewImg.hidden = true;
    previewVideo.hidden = true;
  } catch (err) {
    console.error(err);
    setStatus("Algo salió mal al subir la foto. Intenta de nuevo.", "is-error");
  } finally {
    submitBtn.disabled = false;
    progressEl.hidden = true;
    progressEl.value = 0;
  }
}

/* ---------- Comprime la imagen antes de subirla ----------
   Evita fotos de 8-12 MB directo de un celular; las reduce
   a un ancho máximo razonable en JPEG. */
function comprimirImagen(file, maxAncho = 1600, calidad = 0.82) {
  // Si no es una imagen (video u otro), devolvemos el archivo tal cual
  if (!file || !file.type || !file.type.startsWith("image/")) {
    return Promise.resolve(file);
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const escala = Math.min(1, maxAncho / img.width);
      const w = Math.round(img.width * escala);
      const h = Math.round(img.height * escala);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(url);
          blob ? resolve(blob) : reject(new Error("No se pudo comprimir la imagen"));
        },
        "image/jpeg",
        calidad
      );
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

/* ---------- Ubicación + nombre de lugar legible ----------
   Si el invitado no da permiso, la foto se sube sin ubicación. */
function obtenerUbicacion() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        let etiqueta = null;
        try {
          const resp = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10`
          );
          const data = await resp.json();
          const a = data.address || {};
          etiqueta = a.city || a.town || a.village || a.county || a.state || null;
        } catch (_) {
          /* si falla la geocodificación, igual guardamos lat/lng */
        }
        resolve({ lat, lng, etiqueta });
      },
      () => resolve(null), // permiso denegado o error -> sin ubicación
      { timeout: 8000 }
    );
  });
}

/* ---------- Envío del formulario ---------- */
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const file = fileInput.files[0];
  if (!file) return;
  // Obtener ubicación (si el usuario lo permite) y delegar la subida
  let ubicacion = null;
  try {
    ubicacion = await obtenerUbicacion();
  } catch (err) {
    ubicacion = null;
  }

  await subirFotoYDatos(file, ubicacion);
});

function setStatus(msg, clase) {
  statusEl.textContent = msg;
  statusEl.className = "status" + (clase ? ` ${clase}` : "");
}

/* ---------- Línea de tiempo en vivo ----------
   Más reciente primero, para que quien entre al sitio
   durante la boda vea lo último arriba. */
const formateador = new Intl.DateTimeFormat("es-MX", {
  day: "numeric",
  month: "long",
  hour: "numeric",
  minute: "2-digit",
});

function renderTimelineFromDocs(docs) {
  timelineEl.innerHTML = "";

  if (!docs || docs.length === 0) {
    timelineEmptyEl.hidden = false;
    return;
  }

  timelineEmptyEl.hidden = true;

  docs.forEach((docSnap) => {
    const data = docSnap.data();
    timelineEl.appendChild(crearTarjeta(data, docSnap.id));
  });
}

const fotosQuery = query(collection(db, "fotos"), orderBy("creado", "desc"));
onSnapshot(
  fotosQuery,
  (snapshot) => {
    lastSnapshotDocs = snapshot.docs;
    renderTimelineFromDocs(snapshot.docs);
  },
  (err) => {
    console.error(err);
    setStatus("No se pudo cargar la línea de tiempo.", "is-error");
  }
);

function crearTarjeta(data, docId) {
  const item = document.createElement("article");
  item.className = "timeline-item";

  const meta = document.createElement("div");
  meta.className = "timeline-meta";

  const fecha = data.creado ? data.creado.toDate() : new Date();
  const partes = [];
  partes.push(`<span class="name">${escapeHtml(data.invitado || "Invitado")}</span>`);
  partes.push(`<span>${formateador.format(fecha)}</span>`);
  if (data.ubicacion && data.ubicacion.etiqueta) {
    const etiqueta = escapeHtml(data.ubicacion.etiqueta);
    if (data.ubicacion.lat && data.ubicacion.lng) {
      const lat = data.ubicacion.lat;
      const lng = data.ubicacion.lng;
      const mapHref = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=15/${lat}/${lng}`;
      partes.push(`<a class="pin" href="${mapHref}" target="_blank" rel="noopener">📍 ${etiqueta}</a>`);
    } else {
      partes.push(`<span class="pin">📍 ${etiqueta}</span>`);
    }
  }
  meta.innerHTML = partes.join("");

  // Mostrar video o imagen según el tipo MIME
  let mediaEl;
  if (data.tipo && data.tipo.startsWith("video/")) {
    mediaEl = document.createElement("video");
    mediaEl.controls = true;
    mediaEl.className = "timeline-photo timeline-video";
    mediaEl.alt = `Video subido por ${data.invitado || "un invitado"}`;
    mediaEl.src = data.url;
  } else {
    mediaEl = document.createElement("img");
    mediaEl.className = "timeline-photo is-loading";
    mediaEl.alt = `Foto subida por ${data.invitado || "un invitado"}`;
    mediaEl.src = data.url;
    mediaEl.onload = () => mediaEl.classList.remove("is-loading");
  }

  if (isMasterMode()) {
    const btnEliminar = document.createElement("button");
    btnEliminar.textContent = "🗑️ Eliminar";
    btnEliminar.className = "btn-eliminar";
    btnEliminar.style.cssText = "position: absolute; top: 10px; right: 10px; padding: 5px 10px; background: rgba(255,0,0,0.7); color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; z-index: 10;";
    btnEliminar.onclick = () => eliminarFoto(docId, data.url);
    item.appendChild(btnEliminar);
  }

  item.style.position = "relative";
  item.appendChild(meta);
  item.appendChild(mediaEl);
  return item;
}

async function eliminarFoto(docId, urlFoto) {
  if (!confirm("¿Estás seguro de que deseas eliminar esta foto?")) {
    return;
  }

  try {
    // Eliminar de Firestore
    await deleteDoc(doc(db, "fotos", docId));

    // Eliminar de Storage
    try {
      const path = new URL(urlFoto).pathname.split('/o/')[1].split('?')[0];
      const decodedPath = decodeURIComponent(path);
      const sRef = storageRef(storage, decodedPath);
      await deleteObject(sRef);
    } catch (e) {
      console.warn("No se pudo eliminar el archivo de Storage:", e);
    }

    alert("Foto eliminada correctamente.");
  } catch (err) {
    console.error("Error al eliminar:", err);
    alert("No se pudo eliminar la foto. Intenta de nuevo.");
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}