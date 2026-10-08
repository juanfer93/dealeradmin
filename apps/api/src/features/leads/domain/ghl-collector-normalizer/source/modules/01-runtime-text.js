// Body for the HighLevel Custom Code action used by all four collector workflows.
// Keep this executable without imports: HighLevel provides inputData at runtime.
const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const advisorHandoffVehicle = 'Quiere hablar con un asesor';
const cashDownPayment = 'Pagara en cash / de contado';
const isAdvisorHandoffVehicle = (value) => clean(value).toLocaleLowerCase() === advisorHandoffVehicle.toLocaleLowerCase();
const emptyMarker = (value) => /^(?:--|-|n\/?a|not indicated|not specified|no indicado|no especificado)$/i.test(clean(value));
const first = (...values) => values.map(clean).find((value) => value && !emptyMarker(value)) || '';
const rawMemory = String(inputData.qualification_memory ?? '').trim();
const rawMessage = String(inputData.message ?? '').replace(/\r\n?/g, '\n').trim();
const rawHistory = String(inputData.chat_history_log ?? '').replace(/\r\n?/g, '\n').trim();
const message = clean(rawMessage);
const history = clean(rawHistory);
const normalizeMatch = (value) => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const nonVehicleIntentValues = /^(?:(?:(?:quiero|necesito|me gustar[ií]a|me interesa)\s+)?(?:m[aá]s\s+)?(?:informaci[oó]n|info|detalles?|details?|information)|more\s+(?:information|info|details?)|learn\s+more)$/i;
