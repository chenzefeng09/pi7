// Tests assert the Chinese source strings: with no navigator the locale defaults to English,
// so pin it here to keep t() returning its keys.
import { setLocale } from "./i18n";

setLocale("zh");
