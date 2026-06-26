import os
from dotenv import load_dotenv
import cloudinary
import cloudinary.uploader

load_dotenv()

cloudinary.config(
    cloud_name=os.getenv("CLOUDINARY_CLOUD_NAME"),
    api_key=os.getenv("CLOUDINARY_API_KEY"),
    api_secret=os.getenv("CLOUDINARY_API_SECRET"),
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