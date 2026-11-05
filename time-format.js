'use strict';
// Dates and times shown to a person use that person's time zone and language, never the
// server clock (production runs in UTC). The web app sends the zone and language with every
// request as the x-pn-tz and x-pn-lang headers; direct downloads (links the browser opens)
// pass tz= and lang= in the query string. Anything else falls back to DEFAULT_TIME_ZONE.
const DEFAULT_ZONE = process.env.DEFAULT_TIME_ZONE || 'America/Chicago';
const zoneCache = new Map();

function validZone(zone) {
  if (typeof zone !== 'string' || !zone || zone.length > 64) return false;
  if (zoneCache.has(zone)) return zoneCache.get(zone);
  let ok = false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); ok = true; } catch (e) { ok = false; }
  zoneCache.set(zone, ok);
  return ok;
}

function requestValue(req, name) {
  if (!req) return '';
  const query = req.query && req.query[name];
  if (typeof query === 'string' && query) return query;
  const header = typeof req.get === 'function' ? req.get('x-pn-' + name) : (req.headers && req.headers['x-pn-' + name]);
  return typeof header === 'string' ? header : '';
}

// The zone to format with for this request.
function zoneFrom(req) {
  const zone = requestValue(req, 'tz');
  return validZone(zone) ? zone : DEFAULT_ZONE;
}

// 'en' or 'es' for this request.
function languageFrom(req) {
  return /^es\b/i.test(requestValue(req, 'lang')) ? 'es' : 'en';
}

function localeFor(language) { return language === 'es' ? 'es-US' : 'en-US'; }

// Options may be a request (zone and language are read from it) or {zone, language}.
function settings(options) {
  if (options && (typeof options.get === 'function' || options.headers || options.query)) return { zone: zoneFrom(options), language: languageFrom(options) };
  const zone = options && validZone(options.zone) ? options.zone : DEFAULT_ZONE;
  const language = options && options.language === 'es' ? 'es' : 'en';
  return { zone, language };
}

function toDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (value == null || value === '') return null;
  // A plain calendar date (YYYY-MM-DD) is a day, not an instant: keep it on that day.
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(value + 'T12:00:00Z');
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function format(value, options, formatOptions) {
  const date = toDate(value);
  if (!date) return '';
  const { zone, language } = settings(options);
  try { return new Intl.DateTimeFormat(localeFor(language), { timeZone: zone, ...formatOptions }).format(date); }
  catch (e) { return new Intl.DateTimeFormat(localeFor(language), formatOptions).format(date); }
}

// 11/3/2026 (en) or 3/11/2026 (es)
function formatDate(value, options) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const { language } = settings(options);
    return new Intl.DateTimeFormat(localeFor(language), { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' }).format(new Date(value + 'T12:00:00Z'));
  }
  return format(value, options, { year: 'numeric', month: 'numeric', day: 'numeric' });
}

// November 3, 2026 (en) or 3 de noviembre de 2026 (es)
function formatLongDate(value, options) { return format(value, options, { year: 'numeric', month: 'long', day: 'numeric' }); }

// 5:21 PM (en) or 5:21 p. m. (es)
function formatTime(value, options) { return format(value, options, { hour: 'numeric', minute: '2-digit' }); }

// 11/3/2026, 5:21 PM
function formatDateTime(value, options) { return format(value, options, { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }

// Nov 3, 2026, 5:21 PM CST (zone named, for documents and emails)
function formatDateTimeZone(value, options) { return format(value, options, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }); }

// The calendar date (YYYY-MM-DD) of an instant in the person's zone, for grouping and file names.
function localDateKey(value, options) {
  const date = toDate(value);
  if (!date) return '';
  const { zone } = settings(options);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = type => (parts.find(p => p.type === type) || {}).value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

module.exports = { DEFAULT_ZONE, validZone, zoneFrom, languageFrom, localeFor, settings, formatDate, formatLongDate, formatTime, formatDateTime, formatDateTimeZone, localDateKey };
