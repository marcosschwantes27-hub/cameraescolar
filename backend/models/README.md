# Modelos de reconhecimento facial

Os arquivos ONNX são fixados no commit `47534e27c9851bb1128ccc0102f1145e27f23f98`
do repositório oficial `opencv/opencv_zoo`.

- `face_detection_yunet_2023mar.onnx`: detecção facial YuNet, licença MIT.
- `face_recognition_sface_2021dec.onnx`: reconhecimento SFace, licença Apache 2.0.

Os hashes SHA-256 são registrados após o download em `SHA256SUMS` e validados pela aplicação
antes de carregar os modelos. Os binários são mantidos localmente; não existe chamada a serviço
externo durante o cadastro ou o reconhecimento.
