/* Images the app needs before (or without) the backend: built in by Vite from the desktop assets
   (alias @core-images in vite.config.ts). Everything else still comes from /api/img/<name>. */
import flagGb from "@core-images/flag_gb.svg";
import flagDe from "@core-images/flag_de.svg";
import flagEs from "@core-images/flag_es.svg";
import flagCn from "@core-images/flag_cn.svg";
import logoBlack from "@core-images/tricolour_black.png";
import logo from "@core-images/tricolour.png";

export const FLAGS: Record<string, string> = { "flag_gb.svg": flagGb, "flag_de.svg": flagDe, "flag_es.svg": flagEs, "flag_cn.svg": flagCn };
export const LOGO_BLACK = logoBlack;
export const LOGO = logo;
