# Deploy guide — Boda Bris & Aldo

This repository contains a static site that uploads photos/videos to Firebase Storage and uses Firestore.

Quick steps to push to GitHub and deploy on Netlify:

1) Create a GitHub repo and push (uses GitHub CLI `gh`):

```powershell
# from e:\boda
# edit script parameters if desired
.
\scripts\push_to_github.ps1 -RepoName boda-bris-aldo -Visibility public
```

2) On Netlify: connect GitHub repo and deploy (drag & drop or GitHub integration). Your site will be available at `https://<your-site>.netlify.app`.

3) CORS: update `cors.json` origin with your Netlify URL and apply it to your Storage bucket.

Apply CORS via `gsutil` (Cloud SDK):

```powershell
# replace with your bucket name if different
gsutil cors set e:\boda\cors.json gs://bodabrisaldo.firebasestorage.app
```

Or edit CORS via Google Cloud Console > Storage > your bucket > CORS configuration.

4) Secure rules: ensure Firebase Storage rules allow uploads for your workflow (for production, require auth).

Notes:
- The `cors.json` contains a placeholder `https://your-site.netlify.app`. Replace it with your actual Netlify URL before applying.
- If you prefer, Netlify can also be set up via CLI (`netlify`), but connecting through the web UI is simplest.
