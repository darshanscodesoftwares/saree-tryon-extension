// Where the queue is: the server.mjs that the kiosk is served from. The
// extension's worker polls it for jobs, so it has to be the same server the
// screens post to - and it is the only line that changes between running in
// the office and running hosted.
//
//   "http://localhost:5200"            npm start on this machine
//   "https://<service>.onrender.com"   hosted on Render; a phone on any network
//
// The manifest already allows any *.onrender.com address. After changing this,
// reload the extension at chrome://extensions - a service worker does not pick
// up an edit by itself.
export const QUEUE = "https://saree-tryon-qt39.onrender.com";
