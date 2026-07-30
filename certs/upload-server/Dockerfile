FROM alpine:3.20
RUN apk add --no-cache python3
COPY upload.py /upload.py
EXPOSE 8080
CMD ["python3", "/upload.py"]