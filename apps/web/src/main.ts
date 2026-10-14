import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import Companion from "./Companion.vue";
import { desktop } from "./desktop";
import "./style.css";
const companion =
  desktop && new URLSearchParams(location.search).get("view") === "companion";
if (companion) document.body.classList.add("companion-body");
createApp(companion ? Companion : App)
  .use(createPinia())
  .mount("#app");
