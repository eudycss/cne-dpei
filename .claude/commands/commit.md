Crea un git commit con este mensaje: $ARGUMENTS

Antes de hacer el commit:
- Revisa que no haya console.log olvidados
- Revisa que no haya código comentado temporalmente
- Verifica que no haya TODOs pendientes
figlet -f standard "Sebas" | while IFS= read -r -n1 char; do printf "$char"; sleep 0.005; done; echo ""