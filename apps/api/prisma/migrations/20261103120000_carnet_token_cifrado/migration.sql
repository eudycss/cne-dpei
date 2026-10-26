-- Reimprimir un carnet vigente sin anularlo: el token cifrado (AES-256-GCM,
-- clave CARNET_TOKEN_KEY fuera de la BD) además del hash. Los carnets
-- anteriores quedan en NULL: necesitan una última reemisión.
ALTER TABLE "credenciales_qr_cda" ADD COLUMN "token_cifrado" VARCHAR(120);
