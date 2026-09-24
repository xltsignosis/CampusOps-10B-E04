# **Actividad Semana 4 — Auditoría de seguridad y privacidad**

**Duración estimada:** 1 hora  
**Modalidad:** Individual  
**Valor:** 10 puntos  
**Entrega:** Repositorio de GitHub \+ archivo `docs/security-audit.md`

## **Objetivo de la actividad**

Durante esta actividad vas a revisar tu proyecto como si fueras una persona encargada de realizar una auditoría básica de seguridad.

El objetivo NO es únicamente encontrar errores.

Debes realizar el siguiente proceso:

**Encontrar un problema → explicar por qué representa un riesgo → corregirlo → demostrar que realmente quedó corregido.**

Al finalizar la actividad deberás haber identificado al menos **3 posibles problemas de seguridad o privacidad** y deberás haber corregido correctamente **como mínimo 2 de ellos**.

---

# **¿Qué tienes que hacer?**

Trabajarás sobre el proyecto que has desarrollado durante las semanas anteriores.

Debes revisar cuidadosamente tu código buscando situaciones que puedan provocar que información privada, credenciales, tokens o datos de usuarios sean expuestos accidentalmente.

No debes inventar simplemente tres problemas.

Los problemas que reportes deben estar relacionados con tu proyecto o debes implementar un pequeño ejemplo dentro del proyecto para demostrar correctamente el problema y su solución.

---

# **Parte 1\. Crear tu rama de trabajo**

Antes de modificar cualquier archivo debes crear una rama nueva.

Ejemplo:

git checkout \-b week4/security-audit-\[tu nombre\]

Puedes utilizar otro nombre similar, pero debe quedar claramente identificado que corresponde a la actividad de la Semana 4\.

Comprueba que estás trabajando en la rama correcta:

git branch

La rama actual aparecerá marcada con un `*`.

---

# **Parte 2\. Crea el archivo de evidencia**

Dentro de tu proyecto crea una carpeta llamada:

docs

Dentro de ella crea el archivo:

security-audit.md

Por lo tanto, tu proyecto debe contener:

docs/security-audit.md

Este archivo será una parte MUY IMPORTANTE de la entrega.

Aquí vas a documentar todo lo que encuentres.

---

# **Parte 3\. Busca posibles problemas de seguridad**

Debes revisar tu proyecto buscando como mínimo **3 problemas diferentes**.

Puedes buscar situaciones como las siguientes.

## **A. Credenciales o secretos escritos directamente en el código**

Ejemplo INCORRECTO:

const API\_KEY \= "123456ABCDEF";

Otro ejemplo:

const password \= "admin123";

Otro ejemplo:

const token \= "eyJhbGciOi...";

El problema es que cualquier persona que tenga acceso al repositorio puede ver estos valores.

Una posible solución sería utilizar variables de entorno.

Ejemplo:

const API\_KEY \= process.env.EXPO\_PUBLIC\_API\_KEY;

IMPORTANTE:

Durante esta actividad **NO debes utilizar credenciales reales**.

Si necesitas demostrar el problema utiliza datos ficticios.

Ejemplo:

TEST\_API\_KEY=demo\_key\_123

---

## **B. Información sensible enviada a consola**

Revisa si tienes instrucciones como:

console.log(user);

console.log(password);

console.log(token);

console.log(response);

Imagina que el objeto contiene:

{  
  "name": "Juan Pérez",  
  "email": "juan@email.com",  
  "password": "123456",  
  "token": "ABC123"  
}

Mostrar todo el objeto en consola podría provocar que información sensible aparezca en logs.

Una mejor alternativa sería registrar solamente información necesaria.

Por ejemplo:

console.log("Usuario autenticado correctamente");

o:

console.log({  
  userId: user.id,  
  status: "authenticated"  
});

Nunca debes mostrar contraseñas o tokens.

---

## **C. Datos personales almacenados innecesariamente**

Revisa qué información estás almacenando.

Pregúntate:

**¿Realmente necesito guardar este dato?**

Por ejemplo, no tendría sentido almacenar:

{  
  name: "Juan",  
  password: "123456"  
}

en almacenamiento local únicamente para mostrar el nombre del usuario.

En ese caso podrías almacenar solamente:

{  
  name: "Juan"  
}

La regla es sencilla:

**Si un dato no es necesario, no deberías almacenarlo.**

---

## **D. Información sensible en mensajes de error**

Ejemplo incorrecto:

throw new Error(  
  "Error conectando con mysql://admin:password123@192.168.1.20"  
);

Este mensaje está exponiendo información que podría utilizarse para atacar el sistema.

Una mejor opción sería:

throw new Error("No fue posible conectar con el servicio.");

La información técnica detallada debería manejarse de manera segura y nunca mostrarse directamente al usuario.

---

## **E. Archivos sensibles que podrían llegar al repositorio**

Revisa si existe un archivo:

.env

Después revisa tu archivo:

.gitignore

Debe incluir:

.env

También puedes verificar:

git status

El archivo `.env` no debería aparecer como archivo que será enviado al repositorio.

IMPORTANTE:

Agregar `.env` a `.gitignore` NO elimina automáticamente un archivo que ya fue agregado anteriormente a Git.

Por eso debes comprobar realmente el estado del repositorio.

---

# **Parte 4\. Documenta al menos 3 hallazgos**

En el archivo:

docs/security-audit.md

debes crear una tabla como la siguiente:

\# Auditoría de seguridad — Semana 4

\#\# Hallazgos

| \# | Hallazgo | Riesgo | Solución aplicada | Evidencia |  
|---|---|---|---|---|  
| 1 | Token escrito directamente en el código | Una persona con acceso al repositorio podría obtener el token | Se movió a una variable de entorno | Captura 1 |  
| 2 | Se imprimía información del usuario en consola | Los logs podían revelar información sensible | Se eliminaron los datos sensibles del log | Captura 2 |  
| 3 | El archivo .env no estaba ignorado | Las credenciales podían subirse accidentalmente | Se agregó .env al .gitignore | Captura 3 |

NO copies exactamente estos tres ejemplos si no existen en tu proyecto.

Debes revisar tu proyecto y explicar tus propios hallazgos.

---

# **Parte 5\. Corrige mínimo 2 problemas**

De los tres problemas identificados debes corregir por lo menos **2**.

No será suficiente escribir:

> “Este problema se puede solucionar utilizando variables de entorno”.

Debes realizar realmente la modificación en tu código.

Por ejemplo, si encontraste:

const API\_KEY \= "demo123";

debes modificarlo.

Por ejemplo:

const API\_KEY \= process.env.EXPO\_PUBLIC\_API\_KEY;

También deberías tener un ejemplo de configuración como:

.env.example

con:

EXPO\_PUBLIC\_API\_KEY=

IMPORTANTE:

El archivo `.env.example` puede subir al repositorio porque NO debe contener credenciales reales.

Tu `.env.example` puede contener únicamente los nombres de las variables.

Ejemplo:

EXPO\_PUBLIC\_API\_KEY=  
API\_URL=

---

# **Parte 6\. Demuestra que la corrección funciona**

Esta es una de las partes más importantes de la actividad.

**No cuenta como corrección si no puedes demostrar que quedó corregido.**

Por cada problema corregido debes generar evidencia.

Puedes utilizar:

* captura de pantalla;  
* ejecución de la aplicación;  
* resultado de una prueba;  
* salida de terminal;  
* resultado de `git status`;  
* fragmento de código antes y después;  
* evidencia de que una variable de entorno funciona correctamente.

Por ejemplo, si corregiste el problema del archivo `.env`, puedes ejecutar:

git status

y demostrar que `.env` no aparece entre los archivos que Git pretende agregar.

---

# **Parte 7\. Evidencias**

Dentro de:

docs

crea otra carpeta:

evidence

La estructura podría quedar así:

docs/  
├── security-audit.md  
└── evidence/  
    ├── hallazgo-1.png  
    ├── hallazgo-2.png  
    └── hallazgo-3.png

Utiliza nombres claros.

NO utilices nombres como:

Captura de pantalla 2026-09-24.png

Utiliza nombres como:

token-corregido.png

gitignore-env.png

logs-sanitizados.png

---

# **Parte 8\. Explica cada corrección**

Después de la tabla agrega una sección por cada problema.

Ejemplo:

\#\# Hallazgo 1 — Token escrito directamente en código

\#\#\# Problema encontrado

El token utilizado para conectarse al servicio estaba escrito directamente dentro del archivo \`src/services/api.ts\`.

\#\#\# Riesgo

Una persona con acceso al repositorio podría obtener el token y utilizarlo sin autorización.

\#\#\# Solución

Se eliminó el token del código y se configuró mediante una variable de entorno.

\#\#\# Antes

\`\`\`ts  
const TOKEN \= "demo-token-123";

### **Después**

const TOKEN \= process.env.EXPO\_PUBLIC\_API\_TOKEN;

### **Evidencia**

**![Evidencia]()**

Debes hacer algo similar para tus hallazgos.

\---

\# Parte 9\. Comprobación final

Antes de entregar ejecuta:

\`\`\`bash  
git status

Revisa que NO hayas agregado accidentalmente:

.env

También revisa que no existan contraseñas, tokens o credenciales reales dentro de:

security-audit.md

ni dentro de tus capturas.

TODOS los datos utilizados durante esta actividad deben ser ficticios.

---

# **Parte 10\. Commit final**

Cuando hayas terminado realiza un commit.

Ejemplo:

git add .  
git commit \-m "feat: complete week 4 security audit"

Después sube tu rama:

git push origin week4/security-audit

Si utilizaste otro nombre de rama, reemplázalo en el comando.

---

# **¿Qué tienes que entregar en Classroom?**

Debes entregar el enlace de tu repositorio de GitHub.

Además escribe en la entrega:

Nombre:  
Grupo:  
Repositorio:  
Rama:  
Commit final:

Ejemplo:

Nombre: Juan Pérez López  
Grupo: 10A  
Repositorio: https://github.com/usuario/proyecto  
Rama: week4/security-audit  
Commit final: a1b2c3d

Para conocer el identificador de tu último commit puedes utilizar:

git log \-1 \--oneline

---

# **Estructura mínima esperada**

Tu proyecto debe verse aproximadamente así:

proyecto/  
├── src/  
├── docs/  
│   ├── security-audit.md  
│   └── evidence/  
│       ├── hallazgo-1.png  
│       ├── hallazgo-2.png  
│       └── hallazgo-3.png  
├── .env.example  
├── .gitignore  
├── package.json  
└── README.md

La estructura puede variar dependiendo de tu proyecto.

---

# **Rúbrica**

## **1\. Identificación de problemas — 3 puntos**

Debes identificar mínimo **3 problemas de seguridad o privacidad**.

Cada hallazgo correcto vale:

**1 punto**

El problema debe estar explicado correctamente.

No se otorgará el punto por escribir únicamente frases como:

> “Hay problemas de seguridad”.

Debes indicar específicamente:

* dónde está el problema;  
* qué está ocurriendo;  
* por qué podría ser peligroso.

---

## **2\. Correcciones — 4 puntos**

Debes corregir correctamente mínimo **2 problemas**.

Cada corrección vale:

**2 puntos**

La modificación debe existir realmente dentro del código.

Explicar una solución sin implementarla NO cuenta como corrección.

---

## **3\. Evidencias — 2 puntos**

Debes demostrar que las correcciones funcionan.

Cada evidencia correcta vale:

**1 punto**

La evidencia debe permitir comprobar claramente lo que estás afirmando.

---

## **4\. Calidad de entrega — 1 punto**

Se evaluará:

* archivo `security-audit.md` completo;  
* estructura ordenada;  
* nombres adecuados de archivos;  
* commit correcto;  
* repositorio accesible;  
* ausencia de credenciales reales;  
* instrucciones cumplidas.

---

# **Importante**

### **NO utilices datos reales.**

No debes publicar:

* contraseñas reales;  
* tokens reales;  
* API Keys reales;  
* datos bancarios;  
* números telefónicos reales;  
* direcciones reales;  
* credenciales institucionales;  
* datos personales de terceros.

Utiliza siempre información ficticia.

---

# **Lo que NO debes hacer**

No se aceptará una entrega donde únicamente hayas investigado en Internet qué es la seguridad informática.

No se aceptará un documento con definiciones copiadas.

No se aceptará escribir tres vulnerabilidades sin revisar o modificar el proyecto.

No se aceptará decir que algo está corregido sin evidencia.

No se aceptará únicamente cambiar comentarios o texto para aparentar modificaciones.

No se aceptarán credenciales reales dentro del repositorio.

---

# **Checklist antes de entregar**

Antes de presionar **Entregar** en Classroom verifica lo siguiente:

* Creé una rama para la actividad.  
* Creé `docs/security-audit.md`.  
* Identifiqué mínimo 3 problemas.  
* Expliqué por qué cada problema representa un riesgo.  
* Corregí mínimo 2 problemas.  
* Tengo evidencia de las correcciones.  
* Guardé las evidencias dentro de `docs/evidence`.  
* Revisé mi archivo `.gitignore`.  
* Verifiqué que `.env` no se esté subiendo.  
* No publiqué contraseñas o tokens reales.  
* Realicé el commit final.  
* Subí la rama a GitHub.  
* Coloqué en Classroom el repositorio, rama y commit.

---

## **Regla principal de la actividad**

**Encontrar un problema no es suficiente.**

Debes seguir siempre:

**Problema → Riesgo → Corrección → Evidencia**

Si no existe evidencia de que una corrección funciona, la corrección podrá considerarse incompleta.

