import io
import re
from dataclasses import dataclass
from typing import Dict, Optional

import pdfminer.high_level
from pdfminer.converter import TextConverter
from pdfminer.pdfdocument import PDFDocument
from pdfminer.pdfinterp import PDFPageInterpreter, PDFResourceManager
from pdfminer.pdfpage import PDFPage
from pdfminer.pdfparser import PDFParser

from src.backend.models.equipment import Equipment


@dataclass
class PDFProcessingResult:
    """Result of PDF processing."""
    text: str
    features: Dict[str, Optional[str]]
    equipment: Equipment




class PDFProcessor:
    """
    Service for extracting structured data from equipment manuals.
    """

    def __init__(self):
        # Common patterns for extracting equipment specs from PDFs
        self.patterns = {
            "input_voltage": re.compile(
                r"input\s*voltage\s*[:=]?\s*([\d.]+\s*(?:[-–]\s*[\d.]+\s*)?(?:m?V)\s*(?:AC|DC)?)",
                re.IGNORECASE,
            ),
            "output_voltage": re.compile(
                r"output\s*voltage\s*[:=]?\s*([\d.]+\s*(?:[-–]\s*[\d.]+\s*)?(?:m?V)\s*(?:AC|DC)?)",
                re.IGNORECASE,
            ),
            "output_power": re.compile(
                r"output\s*power\s*[:=]?\s*([\d.]+\s*(?:kW|W))",
                re.IGNORECASE,
            ),
            "frequency_response": re.compile(
                r"frequency\s*response\s*[:=]?\s*"
                r"([\d.]+\s*k?Hz\s*(?:to|[-–~])\s*[\d.]+\s*k?Hz)",
                re.IGNORECASE,
            ),
            "dimensions": re.compile(
                r"dimensions\s*[:=]?\s*([\d.]+\s*[x×]\s*[\d.]+\s*[x×]\s*[\d.]+\s*(?:mm|cm|in))",
                re.IGNORECASE,
            ),
            "weight": re.compile(
                r"weight\s*[:=]?\s*([\d.]+\s*(?:kg|g|lbs|lb|oz))",
                re.IGNORECASE,
            ),
            "signal_to_noise": re.compile(
                r"signal[-\s]*to[-\s]*noise\s*[:=]?\s*([\d.]+\s*dB)",
                re.IGNORECASE,
            ),
            "total_harmonic_distortion": re.compile(
                r"(?:total\s*)?harmonic\s*distortion\s*[:=]?\s*([\d.]+\s*%)",
                re.IGNORECASE,
            ),
            "impedance": re.compile(
                r"impedance\s*[:=]?\s*([\d.]+\s*(?:k?Ω|k?ohms?))",
                re.IGNORECASE,
            ),
        }

    def extract_text_from_pdf(self, pdf_bytes: bytes) -> str:
        """
        Extract plain text from PDF bytes.

        Args:
            pdf_bytes: PDF file content as bytes.

        Returns:
            Extracted text as string.
        """
        try:
            return pdfminer.high_level.extract_text(io.BytesIO(pdf_bytes))
        except Exception:
            return self._extract_text_manual(pdf_bytes)

    def _extract_text_manual(self, pdf_bytes: bytes) -> str:
        """
        Manual text extraction using pdfminer components.

        Args:
            pdf_bytes: PDF file content as bytes.

        Returns:
            Extracted text as string.
        """
        output_string = io.StringIO()
        with io.BytesIO(pdf_bytes) as in_file:
            parser = PDFParser(in_file)
            doc = PDFDocument(parser)
            rsrcmgr = PDFResourceManager()
            device = TextConverter(rsrcmgr, output_string)
            interpreter = PDFPageInterpreter(rsrcmgr, device)
            for page in PDFPage.create_pages(doc):
                interpreter.process_page(page)
            device.close()
        return output_string.getvalue()

    def extract_features(self, text: str) -> Dict[str, Optional[str]]:
        """
        Extract equipment features from text using regex patterns.

        Args:
            text: Input text to search.

        Returns:
            Dictionary of extracted features.
        """
        features = {}
        for key, pattern in self.patterns.items():
            match = pattern.search(text)
            if match:
                features[key] = match.group(1).strip()
            else:
                features[key] = None
        return features

    def process_equipment_manual(
        self, pdf_bytes: bytes, equipment: Equipment
    ) -> Equipment:
        """
        Process an equipment manual PDF and update equipment with extracted specs.

        Args:
            pdf_bytes: PDF file content.
            equipment: Equipment object to update.

        Returns:
            Updated equipment with extracted specifications.
        """
        text = self.extract_text_from_pdf(pdf_bytes)
        features = self.extract_features(text)

        # Update equipment specifications with non-None features
        for key, value in features.items():
            if value is not None:
                equipment.specifications[key] = value

        # Attempt to extract model number if not present
        if not equipment.model:
            model_patterns = [
                re.compile(r"model\s*[:\-]?\s*([a-zA-Z0-9\-\s]+)", re.IGNORECASE),
                re.compile(r"([a-zA-Z]{2,}\d+[a-zA-Z0-9\-\s]*)", re.IGNORECASE),
            ]
            for pattern in model_patterns:
                match = pattern.search(text)
                if match:
                    equipment.model = match.group(1).strip()
                    break

        return equipment
pdf_processor = PDFProcessor()