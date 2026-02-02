# 📱 Ejemplos de Links para Compartir

## 🔗 Estructura del Link

```
https://tu-pwa.com/?booking=HHMMam/pm/DDMMYYYY
```

## ✅ Ejemplos Correctos

### Ejemplo 1: Reserva 6:30 AM del 3 de Febrero 2026
```
https://cayacoa-golf.netlify.app/?booking=630am/03022026
```

### Ejemplo 2: Reserva 7:00 AM del 15 de Marzo 2026
```
https://cayacoa-golf.netlify.app/?booking=700am/15032026
```

### Ejemplo 3: Reserva 2:30 PM del 10 de Abril 2026
```
https://cayacoa-golf.netlify.app/?booking=230pm/10042026
```

### Ejemplo 4: Reserva 11:45 AM del 20 de Mayo 2026
```
https://cayacoa-golf.netlify.app/?booking=1145am/20052026
```

### Ejemplo 5: Reserva 4:15 PM del 8 de Junio 2026
```
https://cayacoa-golf.netlify.app/?booking=415pm/08062026
```

## 📅 Calendario de Ejemplos

| Fecha | Hora | Link |
|-------|------|------|
| 3 Feb 2026 | 6:30 AM | `?booking=630am/03022026` |
| 15 Mar 2026 | 7:00 AM | `?booking=700am/15032026` |
| 10 Abr 2026 | 2:30 PM | `?booking=230pm/10042026` |
| 20 May 2026 | 11:45 AM | `?booking=1145am/20052026` |
| 8 Jun 2026 | 4:15 PM | `?booking=415pm/08062026` |

## 💬 Mensaje de WhatsApp Completo

```
¡Hola Juan! 👋

Tu reserva en Cayacoa Golf está confirmada:

📅 3 de Febrero 2026
⏰ 6:30 AM
🏌️ Campo Principal

Accede directamente aquí:
https://cayacoa-golf.netlify.app/?booking=630am/03022026

✨ La primera vez te pedirá tus credenciales de Cayacoa.
Las próximas veces entrarás automáticamente.

¡Nos vemos en el campo! 🏌️⛳
```

## 🎯 Links para Otros Usos

### Solo login (sin destino específico):
```
https://cayacoa-golf.netlify.app/
```

### Ir directo a página de reservas:
```
https://cayacoa-golf.netlify.app/?redirect=/front-end/tee-time
```

### Ir directo a perfil del usuario:
```
https://cayacoa-golf.netlify.app/?redirect=/front-end/profile
```

## 🔧 Generar Link Automáticamente

### En JavaScript:

```javascript
function generarLinkReserva(hora, fecha) {
  // hora = "6:30 AM" o "2:30 PM"
  // fecha = "03/02/2026" (DD/MM/YYYY)
  
  const [horaStr, meridian] = hora.split(' ');
  const [hours, minutes] = horaStr.split(':');
  const [day, month, year] = fecha.split('/');
  
  const booking = `${hours}${minutes}${meridian.toLowerCase()}/${day}${month}${year}`;
  const link = `https://cayacoa-golf.netlify.app/?booking=${booking}`;
  
  return link;
}

// Ejemplo de uso:
const link = generarLinkReserva("6:30 AM", "03/02/2026");
console.log(link);
// Output: https://cayacoa-golf.netlify.app/?booking=630am/03022026
```

### En Python:

```python
def generar_link_reserva(hora, fecha):
    """
    hora = "6:30 AM" o "2:30 PM"
    fecha = "03/02/2026" (DD/MM/YYYY)
    """
    # Parsear hora
    hora_str, meridian = hora.split(' ')
    hours, minutes = hora_str.split(':')
    
    # Parsear fecha
    day, month, year = fecha.split('/')
    
    # Construir booking
    booking = f"{hours}{minutes}{meridian.lower()}/{day}{month}{year}"
    link = f"https://cayacoa-golf.netlify.app/?booking={booking}"
    
    return link

# Ejemplo de uso:
link = generar_link_reserva("6:30 AM", "03/02/2026")
print(link)
# Output: https://cayacoa-golf.netlify.app/?booking=630am/03022026
```

## 📊 Formato del Parámetro `booking`

```
HHMMam/pm/DDMMYYYY
│││││││││ │││││││└── Año (4 dígitos)
│││││││││ ││││└└──── Mes (2 dígitos)
│││││││││ ││└└────── Día (2 dígitos)
│││││││││ │└──────── Separador
││││││││└─┴────────── AM o PM (minúsculas)
│││││└└───────────── Minutos (2 dígitos)
││└└───────────────── Hora (1 o 2 dígitos)
└└─────────────────── Horas y minutos juntos
```

### Ejemplos de parsing:

| Input | Hora | Minutos | AM/PM | Día | Mes | Año |
|-------|------|---------|-------|-----|-----|-----|
| `630am/03022026` | 6 | 30 | AM | 03 | 02 | 2026 |
| `1145am/20052026` | 11 | 45 | AM | 20 | 05 | 2026 |
| `415pm/08062026` | 4 | 15 | PM | 08 | 06 | 2026 |

## ⚠️ Formatos Incorrectos

❌ `6:30am/03-02-2026` - No uses dos puntos ni guiones
❌ `630AM/03022026` - AM/PM debe ser minúscula
❌ `630am/3/2/2026` - Día y mes deben ser 2 dígitos
✅ `630am/03022026` - Correcto

## 🎁 Bonus: Generador Interactivo

Puedes crear una pequeña página para que tú mismo generes los links fácilmente:

```html
<!DOCTYPE html>
<html>
<head>
    <title>Generador de Links Cayacoa</title>
    <style>
        body { font-family: sans-serif; padding: 40px; max-width: 600px; margin: 0 auto; }
        input, button { padding: 10px; margin: 5px; font-size: 16px; }
        button { background: #10b981; color: white; border: none; cursor: pointer; }
        .result { background: #f0fdf4; padding: 20px; margin-top: 20px; border-radius: 8px; }
        .result a { color: #059669; word-break: break-all; }
    </style>
</head>
<body>
    <h1>🏌️ Generador de Links Cayacoa</h1>
    
    <label>Fecha:</label>
    <input type="date" id="fecha">
    
    <label>Hora:</label>
    <input type="time" id="hora">
    
    <button onclick="generar()">Generar Link</button>
    
    <div id="resultado" class="result" style="display: none;">
        <h3>Link generado:</h3>
        <a id="link" href="" target="_blank"></a>
        <br><br>
        <button onclick="copiar()">Copiar Link</button>
    </div>
    
    <script>
        function generar() {
            const fecha = document.getElementById('fecha').value; // YYYY-MM-DD
            const hora = document.getElementById('hora').value; // HH:MM
            
            if (!fecha || !hora) {
                alert('Por favor ingresa fecha y hora');
                return;
            }
            
            const [year, month, day] = fecha.split('-');
            const [hours, minutes] = hora.split(':');
            
            const meridian = parseInt(hours) >= 12 ? 'pm' : 'am';
            const displayHour = parseInt(hours) > 12 ? parseInt(hours) - 12 : parseInt(hours);
            
            const booking = `${displayHour}${minutes}${meridian}/${day}${month}${year}`;
            const link = `https://cayacoa-golf.netlify.app/?booking=${booking}`;
            
            document.getElementById('link').href = link;
            document.getElementById('link').textContent = link;
            document.getElementById('resultado').style.display = 'block';
        }
        
        function copiar() {
            const link = document.getElementById('link').textContent;
            navigator.clipboard.writeText(link);
            alert('Link copiado!');
        }
    </script>
</body>
</html>
```

Guarda esto como `generador.html` y ábrelo en tu navegador para generar links fácilmente.
