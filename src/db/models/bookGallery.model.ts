import { Model, Schema, model } from 'mongoose';
import { IBookGallery } from '../../interfaces';

type BookGalleryModel = Model<IBookGallery>;
const bookGallerySchema: Schema = new Schema<IBookGallery, BookGalleryModel>({
    bookID: {
        type: Schema.Types.ObjectId,
        ref: 'books', // Reference to the Book model
        required: true,
    },
    imagePath: {
        type: String,
        required: true,
    },
    imageName: {
        type: String,
        required: true,
    },
});

export const BookGallery = model<IBookGallery, BookGalleryModel>('bookgalleries', bookGallerySchema);