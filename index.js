import { createApp } from "vue";
import { createRouter, createWebHashHistory } from "vue-router";
import { GraffitiDecentralized } from "@graffiti-garden/implementation-decentralized";
import { GraffitiPlugin } from "@graffiti-garden/wrapper-vue";

import { createRootShell } from "./pages/shell/shell.js";
import {
  createMessagesDirectoryView,
  createMessagesThreadView,
} from "./pages/messages/messages.js";
import { createFormsView } from "./pages/forms/forms.js";
import { createCalendarView } from "./pages/calendar/calendar.js";
import { createAttendanceView } from "./pages/attendance/attendance.js";
import { createLinksView } from "./pages/links/links.js";
import { createProfileView } from "./pages/profile/profile.js";

const AppRoot = { template: "<router-view />" };

async function bootstrap() {
  const [
    RootShell,
    MessagesDirectoryView,
    MessagesThreadView,
    FormsView,
    CalendarView,
    AttendanceView,
    LinksView,
    ProfileView,
  ] = await Promise.all([
    createRootShell(),
    createMessagesDirectoryView(),
    createMessagesThreadView(),
    createFormsView(),
    createCalendarView(),
    createAttendanceView(),
    createLinksView(),
    createProfileView(),
  ]);

  const router = createRouter({
    history: createWebHashHistory(),
    routes: [
      {
        path: "/",
        component: RootShell,
        children: [
          { path: "", redirect: { name: "messages-directory" } },
          {
            path: "messages",
            name: "messages-directory",
            component: MessagesDirectoryView,
          },
          {
            path: "messages/chat/:channel",
            name: "messages-chat",
            component: MessagesThreadView,
            meta: { hideTabBar: true },
          },
          { path: "forms", name: "forms", component: FormsView },
          { path: "calendar", name: "calendar", component: CalendarView },
          { path: "attendance", name: "attendance", component: AttendanceView },
          { path: "links", name: "links", component: LinksView },
          {
            path: "profile",
            name: "profile",
            component: ProfileView,
          },
          {
            path: "settings",
            redirect: { name: "profile" },
          },
        ],
      },
      { path: "/:pathMatch(.*)*", redirect: { name: "messages-directory" } },
    ],
  });

  createApp(AppRoot)
    .use(router)
    .use(GraffitiPlugin, {
      graffiti: new GraffitiDecentralized(),
    })
    .mount("#app");
}

bootstrap().catch((error) => {
  console.error(error);
  const app = document.getElementById("app");
  if (app) {
    app.textContent = "Failed to load app. Check the console.";
  }
});
