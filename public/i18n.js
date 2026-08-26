(function () {
  const STORAGE_KEY = 'photo-notes-language';
  const ES = {
    'Photo documentation, by voice': 'Documentación fotográfica por voz',
    'Email': 'Correo electrónico', 'Password': 'Contraseña', 'Sign In': 'Iniciar sesión',
    'Wrong email or password. Try again.': 'El correo electrónico o la contraseña no son correctos. Inténtelo de nuevo.',
    'Account menu': 'Menú de la cuenta', 'Photo Notes User': 'Usuario de Photo Notes',
    'Asphalt Pro Plan': 'Plan Asfalto Pro', 'Basic Plan': 'Plan Básico', 'Admin Dashboard': 'Panel de administración', 'Sign Out': 'Cerrar sesión',
    'Photo Notes workflow': 'Flujo de trabajo de Photo Notes', 'Capture': 'Capturar', 'Organize': 'Organizar', 'Edit': 'Editar', 'Create': 'Crear', 'Send': 'Enviar',
    'Report an Issue': 'Reportar un problema', 'Report an issue': 'Reportar un problema', 'Close': 'Cerrar',
    'Tell us what happened, what you expected, and what you were doing when it happened.': 'Cuéntenos qué ocurrió, qué esperaba y qué estaba haciendo cuando ocurrió.',
    'Capturing this page...': 'Capturando esta página...', 'Capturing...': 'Capturando...',
    'What went wrong?': '¿Qué salió mal?', 'Speak Description': 'Dictar descripción',
    'Describe the problem in detail...': 'Describa el problema en detalle...', 'Send Issue Report': 'Enviar reporte del problema',
    'Saving your report...': 'Guardando su reporte...', 'The report could not be sent. Check your connection and try again.': 'No se pudo enviar el reporte. Revise su conexión e inténtelo de nuevo.',
    'Please describe the problem before sending.': 'Describa el problema antes de enviarlo.',
    'Screenshot of this page attached': 'Captura de pantalla de esta página adjunta',
    'Screenshot unavailable; your description will still be saved': 'La captura no está disponible; su descripción se guardará de todos modos',
    'Photo Note': 'Nota fotográfica', 'Take Photo': 'Tomar foto', 'Choose from library or files': 'Elegir de la fototeca o archivos',
    'Other Camera Tools': 'Otras herramientas de cámara', 'Note': 'Nota', 'Record Note': 'Grabar nota',
    "Type what you're looking at, or tap Record Note": 'Escriba lo que está viendo o toque Grabar nota',
    'Select Topic': 'Seleccionar tema', 'Add a topic...': 'Agregar un tema...', 'Add': 'Agregar', 'Save': 'Guardar', 'Send & Save': 'Enviar y guardar',
    'Topic added': 'Tema agregado', 'Could not add topic': 'No se pudo agregar el tema', 'Could not remove topic': 'No se pudo eliminar el tema',
    'No topics yet. Add one below.': 'Todavía no hay temas. Agregue uno abajo.', 'No topics yet': 'Todavía no hay temas',
    'GPS Coordinates': 'Coordenadas GPS', 'Address': 'Dirección', 'Getting location...': 'Obteniendo ubicación...',
    'Getting Full Address...': 'Obteniendo la dirección completa...', 'Looking up address...': 'Buscando la dirección...',
    'Address not found': 'No se encontró la dirección', 'Address lookup failed': 'Falló la búsqueda de la dirección',
    'Location not available on this device.': 'La ubicación no está disponible en este dispositivo.',
    'Location blocked. Allow location for this site to tag photos.': 'La ubicación está bloqueada. Permita la ubicación para este sitio para etiquetar las fotos.',
    'Take a photo or add a note first': 'Primero tome una foto o agregue una nota',
    'Opened email; photo downloaded to attach': 'Se abrió el correo; la foto se descargó para adjuntarla', 'Opened email': 'Se abrió el correo',
    'Camera Tools': 'Herramientas de cámara', 'Choose what the camera needs to do. Source photos are retained for verification.': 'Elija lo que debe hacer la cámara. Las fotos originales se conservan para verificación.',
    'Back to Capture': 'Volver a Capturar', 'Back to Camera Tools': 'Volver a Herramientas de cámara',
    'Document Scanners': 'Escáneres de documentos', 'Turn photographed documents into searchable, reviewable information.': 'Convierta documentos fotografiados en información que se pueda buscar y revisar.',
    'Asphalt Ticket Scanner': 'Escáner de boletos de asfalto', 'Read delivery-ticket details and calculate saved daily tonnage.': 'Lea los datos del boleto de entrega y calcule el tonelaje diario guardado.', 'Scan Ticket': 'Escanear boleto',
    'Plan or Sketch Scanner': 'Escáner de planos o croquis', 'Read visible project, sheet, revision, scale, dimension, and field-note information without estimating missing details.': 'Lea la información visible del proyecto, hoja, revisión, escala, dimensiones y notas de campo sin estimar datos faltantes.', 'Scan Plan or Sketch': 'Escanear plano o croquis',
    'Business Card Scanner': 'Escáner de tarjetas de presentación', 'Read contact and company details from a photographed business card.': 'Lea los datos de contacto y de la empresa de una tarjeta de presentación fotografiada.', 'Scan Business Card': 'Escanear tarjeta',
    'Equipment & Material Scanners': 'Escáneres de equipos y materiales', 'Record identifying information from equipment plates and construction-product labels.': 'Registre información de identificación de placas de equipos y etiquetas de productos de construcción.',
    'Equipment Plate Scanner': 'Escáner de placas de equipos', 'Read manufacturer, model, serial number, year, and equipment specifications.': 'Lea el fabricante, modelo, número de serie, año y especificaciones del equipo.', 'Scan Plate': 'Escanear placa',
    'Material Label Scanner': 'Escáner de etiquetas de materiales', 'Read product, manufacturer, lot, quantity, dates, instructions, and visible warnings.': 'Lea el producto, fabricante, lote, cantidad, fechas, instrucciones y advertencias visibles.', 'Scan Label': 'Escanear etiqueta',
    'Instrument Readers': 'Lectores de instrumentos', 'Capture the displayed value while retaining a photograph of the instrument.': 'Capture el valor mostrado y conserve una fotografía del instrumento.',
    'Gauge & Instrument Reader': 'Lector de medidores e instrumentos', 'Read gauges, scales, hour meters, thermometers, fuel displays, and other instruments.': 'Lea medidores, básculas, horómetros, termómetros, indicadores de combustible y otros instrumentos.', 'Read Instrument': 'Leer instrumento',
    'Comparison Tools': 'Herramientas de comparación', 'Create consistent visual records of work before and after completion.': 'Cree registros visuales consistentes del trabajo antes y después de terminarlo.',
    'Before & After Alignment': 'Alineación de antes y después', 'Use an earlier photo as a framing reference, compare the alignment, and save the pair.': 'Use una foto anterior como referencia de encuadre, compare la alineación y guarde el par.', 'Match Photos': 'Emparejar fotos',
    'Photograph the Ticket': 'Fotografiar el boleto', 'Take Ticket Photo': 'Tomar foto del boleto', 'Choose Existing Photo': 'Elegir foto existente', 'Read Ticket': 'Leer boleto',
    'Today’s Saved Tickets': 'Boletos guardados hoy', 'Today’s Total': 'Total de hoy', 'No tickets saved today.': 'No hay boletos guardados hoy.',
    'Reading Ticket...': 'Leyendo boleto...', 'Reading the printed ticket details. This may take a moment.': 'Leyendo los datos impresos del boleto. Esto puede tardar un momento.',
    'Ticket read. Check every field, correct anything needed, then save.': 'Boleto leído. Revise cada campo, corrija lo necesario y después guarde.',
    'The ticket could not be read automatically. Enter the details below, then save.': 'El boleto no se pudo leer automáticamente. Ingrese los datos abajo y después guarde.',
    'Try Reading Again': 'Intentar leer de nuevo', 'Ticket Read': 'Boleto leído', 'Review and Save': 'Revisar y guardar', 'Save Ticket': 'Guardar boleto',
    'Ticket saved': 'Boleto guardado', 'Ticket could not be saved': 'No se pudo guardar el boleto',
    'Ticket Number': 'Número de boleto', 'Ticket Date': 'Fecha del boleto', 'Plant Name': 'Nombre de la planta', 'Plant Location': 'Ubicación de la planta',
    'Customer / Client': 'Cliente', 'Job / Project': 'Trabajo / Proyecto', 'Truck Number': 'Número de camión', 'Driver': 'Conductor',
    'Mix Code': 'Código de mezcla', 'Mix Description': 'Descripción de la mezcla', 'Gross Weight': 'Peso bruto', 'Tare Weight': 'Tara', 'Net Weight': 'Peso neto', 'Net Tons': 'Toneladas netas',
    'Saved Plan or Sketch Records': 'Registros guardados de planos o croquis', 'Saved Business Card Records': 'Registros guardados de tarjetas de presentación',
    'Saved Equipment Plate Records': 'Registros guardados de placas de equipos', 'Saved Material Label Records': 'Registros guardados de etiquetas de materiales',
    'Saved Gauge & Instrument Readings': 'Lecturas guardadas de medidores e instrumentos', 'No saved records yet.': 'Todavía no hay registros guardados.',
    'Loading...': 'Cargando...', 'Loading tickets...': 'Cargando boletos...', 'Loading your photos...': 'Cargando sus fotos...',
    'Take Photo': 'Tomar foto', 'Choose Photo': 'Elegir foto', 'Ready to read.': 'Listo para leer.', 'Reading...': 'Leyendo...', 'Reading only the information visible in the photo.': 'Leyendo únicamente la información visible en la foto.',
    'Save Record': 'Guardar registro', 'Record Name': 'Nombre del registro', 'Manufacturer': 'Fabricante', 'Model': 'Modelo', 'Serial Number': 'Número de serie', 'Year': 'Año',
    'Equipment Type': 'Tipo de equipo', 'Other Specifications': 'Otras especificaciones', 'Instrument Type': 'Tipo de instrumento', 'Displayed Reading': 'Lectura mostrada',
    'Unit': 'Unidad', 'Equipment Name or Number': 'Nombre o número del equipo', 'Displayed Date or Time': 'Fecha u hora mostrada', 'Reading Notes': 'Notas de la lectura',
    'Project Name': 'Nombre del proyecto', 'Site Address': 'Dirección del sitio', 'Sheet Title': 'Título de la hoja', 'Sheet Number': 'Número de hoja', 'Revision Date': 'Fecha de revisión',
    'Printed Scale': 'Escala impresa', 'Visible Dimensions': 'Dimensiones visibles', 'Visible Notes': 'Notas visibles', 'Product Name': 'Nombre del producto',
    'Product Code': 'Código del producto', 'Lot Number': 'Número de lote', 'Quantity': 'Cantidad', 'Manufactured Date': 'Fecha de fabricación', 'Expiration Date': 'Fecha de vencimiento',
    'Visible Instructions': 'Instrucciones visibles', 'Visible Warnings': 'Advertencias visibles', 'Name': 'Nombre', 'Job Title': 'Cargo', 'Company': 'Empresa', 'Phone': 'Teléfono', 'Website': 'Sitio web',
    'Before Photo': 'Foto de antes', 'Choose the Before Photo': 'Elegir la foto de antes', 'Match the Framing': 'Igualar el encuadre',
    'Stand in the same location. Match the camera height, direction, horizon, and visible landmarks shown below.': 'Colóquese en el mismo lugar. Iguale la altura, dirección, horizonte y puntos de referencia visibles que aparecen abajo.',
    'Take After Photo': 'Tomar foto de después', 'Check the Alignment': 'Revisar la alineación', 'Comparison Overlay': 'Superposición comparativa',
    'Move the slider. Fixed objects should remain in the same position. Retake the after photo if they shift substantially.': 'Mueva el control. Los objetos fijos deben permanecer en la misma posición. Vuelva a tomar la foto de después si se desplazan considerablemente.',
    'After Photo Note': 'Nota de la foto de después', 'Describe the completed work...': 'Describa el trabajo terminado...', 'Retake': 'Volver a tomar', 'Save Matched Pair': 'Guardar par emparejado',
    'Organize your captures': 'Organice sus capturas', 'Choose photos, file them by topic, and place them in the order you need.': 'Elija fotos, archívelas por tema y colóquelas en el orden que necesite.',
    'Filter by Topic': 'Filtrar por tema', 'All Topics': 'Todos los temas', 'Select All': 'Seleccionar todo', 'Clear': 'Limpiar', 'Classify Selected (AI)': 'Clasificar selección (IA)',
    'Before & After Photos': 'Fotos de antes y después', 'Search for Pairs': 'Buscar pares',
    'When work is complete, select one photo from before the job and one photo from after the job. The older photo will be marked Before by default.': 'Cuando termine el trabajo, seleccione una foto de antes y una foto de después. La foto más antigua se marcará como Antes de forma predeterminada.',
    'Create Pair From 2 Selected Photos': 'Crear par con 2 fotos seleccionadas', 'File Selected Under a Topic': 'Archivar la selección bajo un tema', 'Choose Topic': 'Elegir tema', 'Apply': 'Aplicar',
    'Create a new topic...': 'Crear un tema nuevo...', 'Add Selected to a Document': 'Agregar la selección a un documento', 'Choose Document': 'Elegir documento',
    '...or type a new document title': '...o escriba el título de un documento nuevo', 'Open Job Site Map': 'Abrir mapa del sitio', 'Select': 'Seleccionar',
    'No captures yet. Go grab one.': 'Todavía no hay capturas. Tome una ahora.', 'Nothing has been captured yet.': 'Todavía no se ha capturado nada.',
    'Edit your material': 'Edite su material', 'Measure or mark up photos, correct notes, or remove unwanted captures.': 'Mida o marque fotos, corrija notas o elimine capturas no deseadas.',
    'Fix Addresses': 'Corregir direcciones', 'Delete Selected': 'Eliminar selección', 'Edit Address': 'Editar dirección', 'Classify (AI)': 'Clasificar (IA)',
    'Measurements': 'Mediciones', 'Mark Up Photo': 'Marcar foto', 'Crop Photo': 'Recortar foto', 'Edit Note': 'Editar nota',
    'Back to Edit': 'Volver a Editar', 'Measure this photo': 'Medir esta foto', 'Use AI with a visible reference object, or enter the dimensions yourself.': 'Use IA con un objeto de referencia visible o ingrese las dimensiones manualmente.',
    'Measure From Photo': 'Medir a partir de la foto', 'Measure From Photo (AI)': 'Medir a partir de la foto (IA)',
    'Lay the ruler flat on the pavement next to the damage and shoot from directly above.': 'Coloque la regla plana sobre el pavimento junto al daño y tome la foto directamente desde arriba.',
    'Dimensions': 'Dimensiones', 'Length': 'Longitud', 'Width': 'Ancho', 'Depth': 'Profundidad', 'inches deep': 'pulgadas de profundidad', 'Shape': 'Forma',
    'Rectangle': 'Rectángulo', 'Circle': 'Círculo', 'Irregular': 'Irregular', 'Area (Sq Ft)': 'Área (pies cuadrados)', 'Auto-calculated': 'Cálculo automático', 'Save Measurements': 'Guardar mediciones',
    'Measurement service is unavailable. Enter dimensions by hand; the record still saves.': 'El servicio de medición no está disponible. Ingrese las dimensiones manualmente; el registro se guardará de todos modos.',
    'Could not measure from this photo right now. You can enter the dimensions by hand, and the record still saves normally.': 'No se pudo medir esta foto ahora. Puede ingresar las dimensiones manualmente y el registro se guardará normalmente.',
    'Mark Up Photo': 'Marcar foto', 'Add labels, text, boxes, or arrows. Drag each item where you want it, then adjust its appearance below.': 'Agregue etiquetas, texto, cuadros o flechas. Arrastre cada elemento al lugar deseado y después ajuste su apariencia abajo.',
    'Add Item': 'Agregar elemento', 'Date / Time': 'Fecha / Hora', 'Copyright': 'Derechos de autor', 'Topic': 'Tema', 'Custom Text': 'Texto personalizado', 'Box / Rectangle': 'Cuadro / Rectángulo', 'Arrow': 'Flecha',
    'Topic and Defect are available after they have been assigned to this photo.': 'Tema y Defecto estarán disponibles después de asignarlos a esta foto.',
    'No item selected. Add one above.': 'No hay ningún elemento seleccionado. Agregue uno arriba.', 'Save Changes': 'Guardar cambios', 'Download Marked Photo': 'Descargar foto marcada',
    'keeps the markings with this photo in Photo Notes.': 'mantiene las marcas con esta foto en Photo Notes.', 'saves a separate JPEG with the markings permanently visible.': 'guarda un JPEG separado con las marcas visibles permanentemente.',
    'Crop Photo': 'Recortar foto', 'Drag the box to move it. Drag any corner to resize. Everything outside the box is trimmed off. Your original is kept and can be restored.': 'Arrastre el cuadro para moverlo. Arrastre cualquier esquina para cambiar el tamaño. Todo lo que quede fuera se recortará. El original se conserva y puede restaurarse.',
    'Apply Crop': 'Aplicar recorte', 'Restore Original Photo': 'Restaurar foto original',
    'Create a document': 'Crear un documento', 'Build an ordered report from organized captures. PDF and Word documents include the title, description, photos, captions, dates, topics, and locations.': 'Cree un informe ordenado a partir de capturas organizadas. Los documentos PDF y Word incluyen título, descripción, fotos, pies de foto, fechas, temas y ubicaciones.',
    'Start a New Document': 'Iniciar un documento nuevo', 'Document Title': 'Título del documento', 'Subtitle or description (optional)': 'Subtítulo o descripción (opcional)',
    'You can create an empty document, then add captures from Organize.': 'Puede crear un documento vacío y después agregar capturas desde Organizar.', 'Create Document': 'Crear documento', 'Your Documents': 'Sus documentos',
    'Edit Document': 'Editar documento', 'Delete': 'Eliminar', 'No documents yet. Select captures in Organize, then create your first document above.': 'Todavía no hay documentos. Seleccione capturas en Organizar y después cree su primer documento arriba.',
    'Build Your Document': 'Crear su documento', 'Review the title, arrange the photos and captions, then download the finished document when it looks right.': 'Revise el título, ordene las fotos y los pies de foto y descargue el documento terminado cuando esté listo.',
    'All Documents': 'Todos los documentos', 'Document Details': 'Datos del documento', 'Title': 'Título', 'Subtitle or Description': 'Subtítulo o descripción',
    'Not yet scored': 'Aún sin puntuación', 'Classify captures in this site to generate a condition score.': 'Clasifique las capturas de este sitio para generar una puntuación de condición.',
    'Document Contents': 'Contenido del documento', 'These photos and captions are the document preview. Edit captions, change their order, or remove anything you do not want included.': 'Estas fotos y pies de foto son la vista previa del documento. Edite los pies, cambie el orden o elimine lo que no desee incluir.',
    'Photo Caption': 'Pie de foto', 'Save Caption': 'Guardar pie', 'Up': 'Subir', 'Down': 'Bajar', 'Remove': 'Eliminar', 'Reverse Photo Order': 'Invertir el orden de las fotos',
    'Download Finished Document': 'Descargar documento terminado', 'Formats': 'Formatos', 'Choose one or more file types.': 'Elija uno o más tipos de archivo.',
    'Photo quality & format': 'Calidad y formato de la foto', 'Resolution': 'Resolución', 'Standard, up to 2048px (recommended)': 'Estándar, hasta 2048 px (recomendado)',
    'Print quality, up to 3000px': 'Calidad de impresión, hasta 3000 px', 'Full resolution, original size': 'Resolución completa, tamaño original', 'Web / small files, up to 1400px': 'Web / archivos pequeños, hasta 1400 px',
    'File format': 'Formato de archivo', 'JPEG, smaller files (recommended)': 'JPEG, archivos más pequeños (recomendado)', 'PNG, lossless, larger': 'PNG, sin pérdida, más grande', 'WebP, smallest, modern': 'WebP, el más pequeño y moderno', 'Keep original file, no changes': 'Conservar el archivo original sin cambios',
    'Your originals stay full-resolution on the server. These only change what gets exported. Standard JPEG is best for uploading to an AI.': 'Sus originales permanecen en resolución completa en el servidor. Estas opciones solo cambian lo que se exporta. JPEG estándar es lo mejor para cargar a una IA.',
    'Download Selected Formats': 'Descargar formatos seleccionados', 'More Sharing Options': 'Más opciones para compartir', 'Proposal Report': 'Informe de propuesta', 'Proposal PDF': 'Propuesta en PDF', 'Proposal Word': 'Propuesta en Word',
    'Extra Work Records': 'Registros de trabajo adicional', 'Document added scope, unexpected conditions, or customer-requested work.': 'Documente trabajo adicional, condiciones inesperadas o trabajo solicitado por el cliente.',
    'No extra work records yet for this job.': 'Todavía no hay registros de trabajo adicional para este trabajo.', 'Extra Work Record': 'Registro de trabajo adicional', 'Back to Job': 'Volver al trabajo',
    'Reason For Extra Work': 'Motivo del trabajo adicional', 'Describe the reason': 'Describa el motivo', 'Describe the condition and the added work...': 'Describa la condición y el trabajo adicional...',
    'Record Voice Note': 'Grabar nota de voz', 'Customer / Client (optional)': 'Cliente (opcional)', 'Customer or client name': 'Nombre del cliente',
    'Customer / GC Notification (optional)': 'Notificación al cliente / contratista general (opcional)', 'Name of person notified': 'Nombre de la persona notificada', 'Company or role': 'Empresa o función',
    'Caption (optional)': 'Pie de foto (opcional)', 'No photos yet. Add at least one.': 'Todavía no hay fotos. Agregue al menos una.', 'Finish': 'Terminar',
    'Job Site Map': 'Mapa del sitio', 'See where saved photos were taken, filter them by topic or document, and measure pavement areas or roadway spans for takeoffs.': 'Vea dónde se tomaron las fotos guardadas, filtre por tema o documento y mida áreas de pavimento o tramos de carretera para cálculos.',
    'Filter by Document': 'Filtrar por documento', 'All Documents': 'Todos los documentos', 'Satellite imagery can be one or more years old. Verify recent construction on site.': 'Las imágenes satelitales pueden tener uno o más años. Verifique las obras recientes en el sitio.',
    'Optional Takeoff Tools': 'Herramientas opcionales de medición', 'Trace a pavement area or measure a roadway span directly on the satellite map.': 'Trace un área de pavimento o mida un tramo de carretera directamente en el mapa satelital.',
    'Trace Area': 'Trazar área', 'Measure Span': 'Medir tramo', 'Map library could not load. Check your connection.': 'No se pudo cargar el mapa. Revise su conexión.',
    'Send your finished work': 'Envíe su trabajo terminado', 'Share photos directly, download a document, email it, upload it, or print it.': 'Comparta fotos directamente, descargue un documento, envíelo por correo, cárguelo o imprímalo.',
    'Send Selected Captures': 'Enviar capturas seleccionadas', 'Texting an Android phone from this Mac?': '¿Enviando un mensaje a un teléfono Android desde esta Mac?',
    'Your iPhone must have Settings → Apps → Messages → Text Message Forwarding enabled for this Mac, plus MMS or RCS messaging.': 'Su iPhone debe tener activado Ajustes → Apps → Mensajes → Reenvío de mensajes de texto para esta Mac, además de MMS o RCS.',
    'Select one or more captures below, or return to Organize.': 'Seleccione una o más capturas abajo o vuelva a Organizar.', 'Share Photos': 'Compartir fotos', 'Send as PDF': 'Enviar como PDF', 'Send as Word': 'Enviar como Word',
    'Create a document first, or send selected captures above.': 'Primero cree un documento o envíe las capturas seleccionadas arriba.',
    'Roads': 'Carreteras', 'Maintenance': 'Mantenimiento', 'Walls': 'Muros', 'Security': 'Seguridad', 'Landscaping': 'Paisajismo', 'Other': 'Otro',
    'Low': 'Baja', 'Medium': 'Media', 'High': 'Alta', 'Before': 'Antes', 'After': 'Después', 'Open': 'Abrir', 'Cancel': 'Cancelar', 'Rename': 'Cambiar nombre', 'Print': 'Imprimir',
    'Loading captures...': 'Cargando capturas...', 'Loading documents...': 'Cargando documentos...', 'Loading your documents...': 'Cargando sus documentos...',
    'Photos could not be loaded.': 'No se pudieron cargar las fotos.', 'Saved records could not be loaded.': 'No se pudieron cargar los registros guardados.',
    'Exporting...': 'Exportando...', 'Download ready': 'Descarga lista', 'Preparing Download...': 'Preparando descarga...', 'Preparing Downloads...': 'Preparando descargas...',
    'Saving...': 'Guardando...', 'Saved': 'Guardado', 'Save failed': 'No se pudo guardar', 'Delete failed': 'No se pudo eliminar', 'Update failed': 'No se pudo actualizar',
    'Recording... tap to stop': 'Grabando... toque para detener', 'Recording stopped. You can continue by typing or try again': 'La grabación se detuvo. Puede continuar escribiendo o volver a intentarlo',
    'Allow microphone access for this website, then try again': 'Permita el acceso al micrófono para este sitio web y vuelva a intentarlo',
    'Use the microphone key on your keyboard to dictate': 'Use la tecla del micrófono del teclado para dictar', 'Tap the microphone key on your keyboard, then talk': 'Toque la tecla del micrófono del teclado y después hable',
    'Language': 'Idioma', '(Attach the photo just downloaded to this email.)': '(Adjunte a este correo la foto que acaba de descargar.)',
    'Enter the complete address, including street number, city, state, and ZIP:': 'Ingrese la dirección completa, incluido el número, la ciudad, el estado y el código postal:',
    'Pavement width in feet (a standard two-lane residential road is 24):': 'Ancho del pavimento en pies (una calle residencial estándar de dos carriles mide 24):',
    'Enter a valid width': 'Ingrese un ancho válido', 'Name this zone:': 'Nombre esta zona:', 'Rename zone:': 'Cambiar nombre de la zona:',
    'Area': 'Área', 'Roadway': 'Calzada', 'Delete this zone?': '¿Eliminar esta zona?',
    'Delete this document? The photos themselves are kept.': '¿Eliminar este documento? Las fotos se conservarán.',
    'Delete this Extra Work Record and its photos? This cannot be undone.': '¿Eliminar este registro de trabajo adicional y sus fotos? Esta acción no se puede deshacer.',
    'Remove this photo?': '¿Eliminar esta foto?', 'There are no unpaired project photos available. Save a new project photo first, then return here.': 'No hay fotos de proyecto sin emparejar disponibles. Guarde primero una foto nueva del proyecto y después vuelva aquí.',
    'Pothole': 'Bache', 'Alligator Cracking': 'Agrietamiento tipo piel de cocodrilo', 'Transverse Cracking': 'Agrietamiento transversal',
    'Longitudinal Cracking': 'Agrietamiento longitudinal', 'Rutting': 'Ahuellamiento', 'Raveling': 'Desintegración superficial',
    'Edge Cracking': 'Agrietamiento de borde', 'No Defect': 'Sin defecto',
    'Plate': 'Placa', 'Instrument': 'Instrumento', 'Plan or Sketch': 'Plano o croquis', 'Material Label': 'Etiqueta de material', 'Business Card': 'Tarjeta de presentación',
    'Read Plate': 'Leer placa', 'Read Plan or Sketch': 'Leer plano o croquis', 'Read Label': 'Leer etiqueta', 'Read Business Card': 'Leer tarjeta',
    'Choose Existing Photo': 'Elegir foto existente', 'Source photo': 'Foto original', 'Reading complete. Correct anything needed, then save.': 'Lectura terminada. Corrija lo necesario y después guarde.',
    'Fill the frame with the plate, keep the text or display sharp, and avoid glare. Review the reading before saving.': 'Llene el encuadre con la placa, mantenga nítidos el texto o la pantalla y evite los reflejos. Revise la lectura antes de guardar.',
    'Fill the frame with the instrument, keep the text or display sharp, and avoid glare. Review the reading before saving.': 'Llene el encuadre con el instrumento, mantenga nítidos el texto o la pantalla y evite los reflejos. Revise la lectura antes de guardar.',
    'Fill the frame with the plan or sketch, keep the text or display sharp, and avoid glare. Review the reading before saving.': 'Llene el encuadre con el plano o croquis, mantenga nítidos el texto o la pantalla y evite los reflejos. Revise la lectura antes de guardar.',
    'Fill the frame with the material label, keep the text or display sharp, and avoid glare. Review the reading before saving.': 'Llene el encuadre con la etiqueta de material, mantenga nítidos el texto o la pantalla y evite los reflejos. Revise la lectura antes de guardar.',
    'Fill the frame with the business card, keep the text or display sharp, and avoid glare. Review the reading before saving.': 'Llene el encuadre con la tarjeta de presentación, mantenga nítidos el texto o la pantalla y evite los reflejos. Revise la lectura antes de guardar.',
    '1. Photograph the Plate': '1. Fotografiar la placa', '1. Photograph the Instrument': '1. Fotografiar el instrumento',
    '1. Photograph the Plan or Sketch': '1. Fotografiar el plano o croquis', '1. Photograph the Material Label': '1. Fotografiar la etiqueta de material',
    '1. Photograph the Business Card': '1. Fotografiar la tarjeta de presentación',
    'Automatic reading was unsuccessful. Enter the visible information, then save.': 'La lectura automática no tuvo éxito. Ingrese la información visible y después guarde.',
    'Try Again': 'Intentar de nuevo', 'AI confidence:': 'Confianza de la IA:', 'The photograph is the source of truth.': 'La fotografía es la fuente original.',
    'Unforeseen site condition': 'Condición imprevista del sitio', 'Failed base or sub-base': 'Base o subbase fallida',
    'Additional damaged area found': 'Se encontró un área dañada adicional', 'Drainage or water issue': 'Problema de drenaje o agua',
    'Customer-requested addition': 'Trabajo adicional solicitado por el cliente', 'Additional repair or patching': 'Reparación o parche adicional',
    'Access, obstruction, or site-preparation issue': 'Problema de acceso, obstrucción o preparación del sitio', 'Safety issue': 'Problema de seguridad',
    'Documented': 'Documentado', 'Sent for review': 'Enviado para revisión', 'Approved': 'Aprobado', 'Declined': 'Rechazado',
    'Completed': 'Completado', 'Closed / no action': 'Cerrado / sin acción', '(method)': '(método)', 'In person': 'En persona',
    'Phone call': 'Llamada telefónica', 'Text message': 'Mensaje de texto',
    'Created': 'Creado', 'by': 'por', 'Measured:': 'Medido:', 'matched defects': 'defectos coincidentes',
    'All Rights Reserved.': 'Todos los derechos reservados.'
    ,'(at least one required)': '(se requiere al menos uno)', '+ Extra Work Record': '+ Registro de trabajo adicional',
    'The photograph is the source of truth.': 'La fotografía es la fuente original.', 'The photographed ticket is the source of truth.': 'La fotografía del boleto es la fuente original.',
    '1. Choose the Before Photo': '1. Elegir la foto de antes', '1. Document Details': '1. Datos del documento', '1. Photograph the Ticket': '1. Fotografiar el boleto',
    '2. Document Contents': '2. Contenido del documento', '2. Match the Framing': '2. Igualar el encuadre', '2. Review and Save': '2. Revisar y guardar',
    '3. Check the Alignment': '3. Revisar la alineación', '3. Download Finished Document': '3. Descargar el documento terminado',
    '12-inch Ruler': 'Regla de 12 pulgadas', '25-foot Tape': 'Cinta de 25 pies', 'AI ZIP': 'ZIP para IA', 'For AI (.zip)': 'Para IA (.zip)',
    'Attach to document': 'Adjuntar al documento', 'Before / After': 'Antes / Después', 'Capture wide shots for context and close-ups for detail.': 'Tome fotos amplias para mostrar el contexto y primeros planos para mostrar los detalles.',
    'Change': 'Cambiar', 'Color': 'Color', 'Confirm this low-confidence estimate for use in exports': 'Confirmar esta estimación de baja confianza para usarla en exportaciones',
    'Could not load group.': 'No se pudo cargar el grupo.', 'Could not load record.': 'No se pudo cargar el registro.', 'Could not load.': 'No se pudo cargar.',
    'Customer / GC Notification': 'Notificación al cliente / contratista general', 'Delete Record': 'Eliminar registro', 'Delete This Item': 'Eliminar este elemento',
    'Description': 'Descripción', 'Dimensions:': 'Dimensiones:', 'Direction': 'Dirección', 'Edit points': 'Editar puntos', 'Export PDF': 'Exportar PDF',
    'Font': 'Fuente', 'Heavy (Impact)': 'Gruesa (Impact)', 'Line Thickness': 'Grosor de línea', 'Measure': 'Medir', 'Measure this site on the Map': 'Medir este sitio en el mapa',
    'No photos in this document yet. Go to Organize, select some, and use "Add Selected to a Document".': 'Este documento todavía no tiene fotos. Vaya a Organizar, seleccione algunas y use "Agregar la selección a un documento".',
    'No reference object found.': 'No se encontró ningún objeto de referencia.', 'Open in Organize': 'Abrir en Organizar', 'Outline for legibility': 'Contorno para mejorar la legibilidad',
    'Photo Notes': 'Photo Notes', 'Photos': 'Fotos', 'Position (corners)': 'Posición (esquinas)', 'Save PDF': 'Guardar PDF', 'Save Word': 'Guardar Word',
    'Select the original photo, use it as your framing reference, then compare the new photo before saving the pair.': 'Seleccione la foto original, úsela como referencia de encuadre y compare la foto nueva antes de guardar el par.',
    'Send a Document': 'Enviar un documento', 'Share PDF': 'Compartir PDF', 'Size': 'Tamaño', 'Status': 'Estado', 'Task': 'Tarea',
    'Take a clear, straight-on photo of the entire delivery ticket. Review every field before saving.': 'Tome una foto clara y de frente de todo el boleto de entrega. Revise cada campo antes de guardar.',
    'Today’s tickets could not be loaded.': 'No se pudieron cargar los boletos de hoy.', 'Track the record’s status according to your company’s normal approval process.': 'Registre el estado de acuerdo con el proceso normal de aprobación de su empresa.',
    'Unpair': 'Separar', 'What Was Found, What Is Needed, And Why?': '¿Qué se encontró, qué se necesita y por qué?', 'What reference is in the photo?': '¿Qué referencia aparece en la foto?',
    'ft': 'pies', 'in': 'pulg.', '‹ All Documents': '‹ Todos los documentos', '‹ Back to Camera Tools': '‹ Volver a Herramientas de cámara',
    '‹ Back to Capture': '‹ Volver a Capturar', '‹ Back to Edit': '‹ Volver a Editar', '‹ Back to Job': '‹ Volver al trabajo', '← Back to Edit': '← Volver a Editar',
    '↑ Up': '↑ Subir', '↓ Down': '↓ Bajar', '↔ Flip': '↔ Voltear', 'Top L': 'Sup. izq.', 'Top R': 'Sup. der.', 'Bot L': 'Inf. izq.', 'Bot R': 'Inf. der.'
    ,'(no note)': '(sin nota)', 'Add at least 2 points': 'Agregue al menos 2 puntos', 'Add at least 3 corners': 'Agregue al menos 3 esquinas',
    'Add at least one photo before saving': 'Agregue al menos una foto antes de guardar', 'A photo could not upload. Check your connection.': 'No se pudo cargar una foto. Revise su conexión.',
    'Address could not be saved': 'No se pudo guardar la dirección', 'Address saved': 'Dirección guardada', 'All photos uploaded': 'Todas las fotos se cargaron',
    'Allow microphone access for this site, then tap Record Note again': 'Permita el acceso al micrófono para este sitio y después toque Grabar nota de nuevo',
    'Arrival Time': 'Hora de llegada', 'Attach failed': 'No se pudo adjuntar', 'Attached to document': 'Adjuntado al documento',
    'Before and after pair saved': 'Par de antes y después guardado', 'Building...': 'Creando...', 'Caption could not be saved': 'No se pudo guardar el pie de foto',
    'Caption saved': 'Pie de foto guardado', 'Changes saved': 'Cambios guardados', 'Choose a document in the filter above first, then Attach': 'Primero elija un documento en el filtro de arriba y después toque Adjuntar',
    'Choose a saved photo first': 'Primero elija una foto guardada', 'Choose a topic': 'Elija un tema', 'Classifying...': 'Clasificando...',
    'Could not add to document': 'No se pudo agregar al documento', 'Could not build document': 'No se pudo crear el documento', 'Could not classify this photo': 'No se pudo clasificar esta foto',
    'Could not create group': 'No se pudo crear el grupo', 'Could not create topic': 'No se pudo crear el tema', 'Could not download marked photo': 'No se pudo descargar la foto marcada',
    'Could not save zone': 'No se pudo guardar la zona', 'Could not share photos': 'No se pudieron compartir las fotos', 'Crop failed, try again': 'Falló el recorte; inténtelo de nuevo',
    'Cropping...': 'Recortando...', 'Deleting...': 'Eliminando...', 'Describe the "other" reason': 'Describa el otro motivo',
    'Did not catch that. Tap Record Note and speak again': 'No se entendió. Toque Grabar nota y vuelva a hablar', 'Dispatch Temperature (°F)': 'Temperatura de despacho (°F)',
    'Dispatch Time': 'Hora de despacho', 'Document created. Add or review its contents below.': 'Documento creado. Agregue o revise su contenido abajo.', 'Document deleted': 'Documento eliminado',
    'Enter a complete address': 'Ingrese una dirección completa', 'Enter the reference length': 'Ingrese la longitud de referencia', 'Export failed': 'Falló la exportación',
    'Extra Work Record saved to this job': 'Registro de trabajo adicional guardado en este trabajo', 'File ready. Attach it to email, text, or upload it to Drive.': 'Archivo listo. Adjúntelo a un correo o mensaje, o cárguelo en Drive.',
    'Fix addresses failed': 'No se pudieron corregir las direcciones', 'Fixing...': 'Corrigiendo...', 'Highlighted values were filled in from your recording. Tap to confirm or edit.': 'Los valores resaltados se completaron a partir de su grabación. Toque para confirmar o editar.',
    'Job Number': 'Número de trabajo', 'Marked photo downloaded': 'Foto marcada descargada', 'Matched pair could not be saved': 'No se pudo guardar el par emparejado',
    'Measurements could not be saved': 'No se pudieron guardar las mediciones', 'Measurements saved': 'Mediciones guardadas', 'Measuring...': 'Midiendo...',
    'Microphone access is off for Photo Notes. Allow it for this website, then tap Record Note again': 'El acceso al micrófono está desactivado para Photo Notes. Permítalo para este sitio y después toque Grabar nota de nuevo',
    'No address': 'Sin dirección', 'No description': 'Sin descripción', 'No location': 'Sin ubicación', 'Note saved': 'Nota guardada',
    'Original photo restored': 'Foto original restaurada', 'PDF ready': 'PDF listo', 'Pairing failed': 'No se pudo emparejar', 'Photo added': 'Foto agregada',
    'Photo cropped. Original saved.': 'Foto recortada. Se guardó la original.', 'Pick a document or type a new title': 'Elija un documento o escriba un título nuevo',
    'Pick at least one format': 'Elija al menos un formato', 'Plant Address': 'Dirección de la planta', 'Proposal export failed': 'Falló la exportación de la propuesta',
    'Proposal ready': 'Propuesta lista', 'Re-shoot with the ruler in frame.': 'Vuelva a tomar la foto con la regla dentro del encuadre.', 'Record could not be saved': 'No se pudo guardar el registro',
    'Record deleted': 'Registro eliminado', 'Record saved': 'Registro guardado', 'Recording could not start. Tap Record Note to try again': 'No se pudo iniciar la grabación. Toque Grabar nota para intentarlo de nuevo',
    'Recording stopped unexpectedly. Tap Record Note to try again': 'La grabación se detuvo inesperadamente. Toque Grabar nota para intentarlo de nuevo',
    'Remove failed': 'No se pudo eliminar', 'Rename failed': 'No se pudo cambiar el nombre', 'Restore failed': 'No se pudo restaurar', 'Rotate failed': 'No se pudo girar',
    'Select at least one capture': 'Seleccione al menos una captura', 'Select exactly two captures to pair': 'Seleccione exactamente dos capturas para emparejar',
    'Send failed': 'No se pudo enviar', 'Sending...': 'Enviando...', 'Speech recognition could not connect. Check your internet connection and try again': 'El reconocimiento de voz no pudo conectarse. Revise su conexión a internet e inténtelo de nuevo',
    'Status updated': 'Estado actualizado', 'Take or choose a ticket photo first': 'Primero tome o elija una foto del boleto',
    'Tap points along the road centerline, then Finish and enter width.': 'Toque puntos a lo largo de la línea central de la calle, después toque Terminar e ingrese el ancho.',
    'Tap the map to drop area corners. Drag a corner to adjust. Tap Finish to close.': 'Toque el mapa para colocar las esquinas del área. Arrastre una esquina para ajustarla. Toque Terminar para cerrar.',
    'The microphone is unavailable. Close any other app using it, then try again': 'El micrófono no está disponible. Cierre cualquier otra aplicación que lo esté usando e inténtelo de nuevo',
    'The ticket could not be read. Retake it in good light with the full ticket visible.': 'No se pudo leer el boleto. Vuelva a fotografiarlo con buena luz y el boleto completo visible.',
    'This browser cannot access the microphone. Type the note or use the keyboard microphone': 'Este navegador no puede acceder al micrófono. Escriba la nota o use el micrófono del teclado',
    'Topic created': 'Tema creado', 'Type a topic name': 'Escriba el nombre del tema', 'Unpair failed': 'No se pudo separar',
    'Untitled document': 'Documento sin título', 'Untitled group': 'Grupo sin título', 'Upload failed': 'No se pudo cargar', 'Uploading photo…': 'Cargando foto…',
    'Zone deleted': 'Zona eliminada', 'Zone saved': 'Zona guardada', '✓ Screenshot of this page attached': '✓ Captura de pantalla de esta página adjunta',
    'Photo quality check': 'Revisión de calidad de la foto', 'Photo quality check passed.': 'La foto pasó la revisión de calidad.',
    'low resolution': 'resolución baja', 'too dark': 'demasiado oscura', 'overexposed': 'sobreexpuesta', 'possibly blurry': 'posiblemente borrosa',
    'Photo quality warning:': 'Advertencia sobre la calidad de la foto:', 'Choose OK to save this photo anyway, or Cancel to retake it.': 'Elija Aceptar para guardar esta foto de todos modos o Cancelar para volver a tomarla.',
    'Photo kept for retaking': 'La foto se conservó para volver a tomarla', 'Photo saved offline. Upload will continue automatically.': 'La foto se guardó sin conexión. La carga continuará automáticamente.',
    'Search Photos': 'Buscar fotos', 'Search notes, addresses, topics, dates, or defects': 'Buscar notas, direcciones, temas, fechas o defectos', 'Search': 'Buscar',
    'Verify Photo Evidence': 'Verificar evidencia fotográfica', 'Photo Evidence Verification': 'Verificación de evidencia fotográfica',
    'This verifies when the original was received and records later changes without displaying private note text.': 'Esto verifica cuándo se recibió el original y registra los cambios posteriores sin mostrar el texto privado de la nota.',
    'Original File Fingerprint': 'Huella digital del archivo original', 'Not available for this older capture': 'No disponible para esta captura anterior',
    'Verified': 'Verificada', 'Does not match': 'No coincide', 'Unavailable': 'No disponible', 'Evidence History': 'Historial de evidencia',
    'Original capture saved': 'Captura original guardada', 'Details updated': 'Datos actualizados', 'Photo rotated': 'Foto girada', 'Photo flipped': 'Foto volteada', 'Photo cropped': 'Foto recortada',
    'No edit history is available for this older capture.': 'No hay historial de edición disponible para esta captura anterior.', 'Evidence details could not be loaded': 'No se pudieron cargar los datos de evidencia'
  };

  const ES_TO_EN = Object.fromEntries(Object.entries(ES).map(([en, es]) => [es, en]));
  const ATTRS = ['placeholder', 'aria-label', 'title'];
  let language = localStorage.getItem(STORAGE_KEY) === 'es' ? 'es' : 'en';
  let applying = false;

  function dynamic(text, lang) {
    const table = lang === 'es' ? ES : ES_TO_EN;
    if (table[text]) return table[text];
    const rules = lang === 'es' ? [
      [/^Select Topic: (.+)( [▴▾])$/, (_, a, c) => `Seleccionar tema: ${ES[a] || a}${c}`],
      [/^Select Topic( [▴▾])$/, (_, c) => `Seleccionar tema${c}`],
      [/^(\d+) photos$/, '$1 fotos'], [/^(\d+) photo$/, '$1 foto'], [/^(\d+) tons$/, '$1 toneladas'],
      [/^(\d+) matching photos?$/, '$1 foto(s) encontrada(s)'], [/^(\d+) offline captures? ready to upload$/, '$1 captura(s) sin conexión lista(s) para cargar'],
      [/^(\d+) photos? saved offline$/, '$1 foto(s) guardada(s) sin conexión'],
      [/^Fingerprint status: (Verified|Does not match|Unavailable)$/, (_, s) => `Estado de la huella: ${ES[s] || s}`],
      [/^Original size: (.+) · Received (.+)$/, 'Tamaño original: $1 · Recibida $2'],
      [/^GPS recorded: (Yes|No) · Address recorded: (Yes|No) · Original backup: (Preserved|Not currently needed)$/, (_, g, a, b) => `GPS registrado: ${g === 'Yes' ? 'Sí' : 'No'} · Dirección registrada: ${a === 'Yes' ? 'Sí' : 'No'} · Respaldo original: ${b === 'Preserved' ? 'Conservado' : 'No necesario actualmente'}`],
      [/^Ticket (.+)$/, 'Boleto $1'], [/^Issue #(\d+) saved\. Thank you\.$/, 'Problema #$1 guardado. Gracias.'],
      [/^Issue #(\d+) sent\. Thank you\.$/, 'Problema #$1 enviado. Gracias.'],
      [/^Score (\d+)$/, 'Puntuación $1'], [/^Added (\d+) photo(s?)$/, 'Se agregaron $1 foto$2'],
      [/^(\d+) corner\(s\)$/, '$1 esquina(s)'], [/^(\d+) point\(s\)$/, '$1 punto(s)'],
      [/^Area: (.+) sq ft \((\d+) corners\)$/, 'Área: $1 pies cuadrados ($2 esquinas)'],
      [/^Length: (.+) ft$/, 'Longitud: $1 pies'], [/^(.+) sq ft$/, '$1 pies cuadrados'], [/^(.+) ft$/, '$1 pies'],
      [/^Defect: (.+)$/, 'Defecto: $1'], [/^Download failed for (.+)$/, 'Falló la descarga de $1'], [/^Export failed for (.+)$/, 'Falló la exportación de $1'],
      [/^Job: (.+)$/, 'Trabajo: $1'], [/^approx length (.+)$/, 'longitud aprox. $1'], [/^approx\. (.+)$/, 'aprox. $1'],
      [/^(© \d{4} Zukor AI\.) All Rights Reserved\.$/, '$1 Todos los derechos reservados.'],
      [/^Delete (\d+) capture(s?)\? This can't be undone\.$/, '¿Eliminar $1 captura$2? Esta acción no se puede deshacer.'],
      [/^Before = capture #(\d+) \(older\), After = capture #(\d+)\.\n\nOK to keep this order, or Cancel to swap Before\/After\.$/, 'Antes = captura #$1 (más antigua), Después = captura #$2.\n\nAceptar para conservar este orden o Cancelar para intercambiar Antes/Después.'],
      [/^Fill the frame with the (.+), keep the text or display sharp, and avoid glare\. Review the reading before saving\.$/, 'Llene el encuadre con $1, mantenga nítidos el texto o la pantalla y evite los reflejos. Revise la lectura antes de guardar.'],
      [/^1\. Photograph the (.+)$/, '1. Fotografiar $1'], [/^Saved (.+) Records$/, 'Registros guardados de $1'], [/^Saved (.+) Readings$/, 'Lecturas guardadas de $1'],
      [/^The (.+) could not be read\. Retake the photo closer, in even light, and avoid glare\.$/, 'No se pudo leer $1. Vuelva a tomar la foto más cerca, con luz uniforme y sin reflejos.'],
      [/^Remove the "(.+)" topic\? Photos already tagged keep their label\.$/, '¿Eliminar el tema "$1"? Las fotos ya etiquetadas conservarán su etiqueta.']
    ] : [
      [/^Seleccionar tema: (.+)( [▴▾])$/, (_, a, c) => `Select Topic: ${ES_TO_EN[a] || a}${c}`],
      [/^Seleccionar tema( [▴▾])$/, (_, c) => `Select Topic${c}`],
      [/^(\d+) fotos$/, '$1 photos'], [/^(\d+) foto$/, '$1 photo'], [/^(\d+) toneladas$/, '$1 tons'],
      [/^Boleto (.+)$/, 'Ticket $1'], [/^Problema #(\d+) guardado\. Gracias\.$/, 'Issue #$1 saved. Thank you.'],
      [/^Problema #(\d+) enviado\. Gracias\.$/, 'Issue #$1 sent. Thank you.'], [/^Puntuación (\d+)$/, 'Score $1']
    ];
    for (const [re, replacement] of rules) if (re.test(text)) return text.replace(re, replacement);
    return text;
  }

  function translateTextNode(node) {
    if (!node || !node.parentElement || node.parentElement.closest('script,style,[data-no-translate]')) return;
    const raw = node.nodeValue || '';
    const trimmed = raw.trim();
    if (!trimmed) return;
    const translated = dynamic(trimmed, language);
    if (translated !== trimmed) node.nodeValue = raw.replace(trimmed, translated);
  }

  function translateElement(el) {
    if (!(el instanceof Element) || el.closest('[data-no-translate]')) return;
    for (const attr of ATTRS) {
      const value = el.getAttribute(attr);
      if (!value) continue;
      const translated = dynamic(value, language);
      if (translated !== value) el.setAttribute(attr, translated);
    }
  }

  function applyTranslations(root) {
    if (applying) return;
    applying = true;
    try {
      if (root instanceof Element) translateElement(root);
      const walker = document.createTreeWalker(root || document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) node.nodeType === Node.TEXT_NODE ? translateTextNode(node) : translateElement(node);
      document.documentElement.lang = language;
      document.querySelectorAll('[data-language]').forEach(btn => {
        const active = btn.getAttribute('data-language') === language;
        btn.classList.toggle('active', active); btn.setAttribute('aria-pressed', String(active));
      });
    } finally { applying = false; }
  }

  function setLanguage(next) {
    language = next === 'es' ? 'es' : 'en';
    localStorage.setItem(STORAGE_KEY, language);
    applyTranslations(document.body);
    document.dispatchEvent(new CustomEvent('photo-notes-languagechange', { detail: { language } }));
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-language]');
    if (button) setLanguage(button.getAttribute('data-language'));
  });
  const observer = new MutationObserver(records => {
    if (applying) return;
    for (const record of records) {
      if (record.type === 'characterData') translateTextNode(record.target);
      record.addedNodes.forEach(node => applyTranslations(node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement));
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  window.photoNotesI18n = { setLanguage, getLanguage: () => language, t: text => dynamic(text, language), apply: applyTranslations };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => applyTranslations(document.body));
  else applyTranslations(document.body);
})();
