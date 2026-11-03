import cloudinary
import cloudinary.uploader

from app.core.config import settings

cloudinary.config(
    cloud_name=settings.cloudinary_cloud_name,
    api_key=settings.cloudinary_api_key,
    api_secret=settings.cloudinary_api_secret,
)


def upload_file_to_cloudinary(file_bytes, filename: str) -> str:
    """
    Uploads a file's raw bytes to Cloudinary and returns the public URL.
    resource_type='auto' lets Cloudinary detect images, PDFs, etc. automatically.
    """
    result = cloudinary.uploader.upload(
        file_bytes,
        resource_type="auto",
        public_id=filename,
    )
    return result["secure_url"]
